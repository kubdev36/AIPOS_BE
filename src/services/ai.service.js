const axios = require("axios");
const path = require("path");
const sharp = require("sharp");
const { createWorker, PSM } = require("tesseract.js");

const OCR_DATA_PATH = path.resolve(__dirname, "../../ocr-data");

const extractBalancedJsonBlock = (text = "") => {
  const value = String(text || "").trim();
  const startIndexes = [];

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{" || value[index] === "[") {
      startIndexes.push(index);
    }
  }

  for (const startIndex of startIndexes) {
    const stack = [];
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < value.length; index += 1) {
      const char = value[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "{" || char === "[") {
        stack.push(char);
        continue;
      }

      if (char === "}" || char === "]") {
        const last = stack[stack.length - 1];
        if ((char === "}" && last === "{") || (char === "]" && last === "[")) {
          stack.pop();
          if (stack.length === 0) {
            return value.slice(startIndex, index + 1);
          }
        } else {
          break;
        }
      }
    }
  }

  return "";
};

const extractJsonFromText = (text) => {
  const rawText = String(text || "").trim();

  try {
    return JSON.parse(rawText);
  } catch (error) {
    const cleanedText = rawText
      .replace(/```json/gi, "```")
      .replace(/```/g, "")
      .trim();

    const balancedJson = extractBalancedJsonBlock(cleanedText);
    if (!balancedJson) {
      throw new Error("AI response is not valid JSON");
    }

    return JSON.parse(balancedJson);
  }
};

const looksLikeConversationalOcrFailure = (text = "") => {
  const normalized = String(text || "").trim().toLowerCase();

  if (!normalized) return true;

  return [
    "rat tiec",
    "rất tiếc",
    "xin loi",
    "xin lỗi",
    "khong the",
    "không thể",
    "ban co the cung cap",
    "bạn có thể cung cấp",
    "toi can xem xet",
    "tôi cần xem xét",
    "khong co bat ky van ban",
    "không có bất kỳ văn bản",
    "ocr_failed",
  ].some((pattern) => normalized.includes(pattern));
};

const normalizeOcrText = (text = "") => {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const normalizeOcrLine = (line = "") => {
  return String(line || "")
    .replace(/[|]{2,}/g, "|")
    .replace(/[._]{2,}/g, " ")
    .replace(/[“”"`~^]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const isUsefulOcrMenuLine = (line = "") => {
  const normalized = normalizeOcrLine(line);
  if (!normalized) return false;
  if (/(?:\d{1,3}(?:[.,]\d{3})+|\d+\s*(?:k|K))/i.test(normalized)) return true;

  const alphaCount = (normalized.match(/\p{L}/gu) || []).length;
  const digitCount = (normalized.match(/\d/g) || []).length;
  const symbolCount = (normalized.match(/[^\p{L}0-9\s]/gu) || []).length;

  if (alphaCount < 4) return false;
  if (symbolCount > alphaCount) return false;
  if (digitCount > alphaCount) return false;

  return true;
};

const isLikelyWatermarkLine = (line = "") => {
  const normalized = normalizeOcrLine(line).toLowerCase();

  if (!normalized) return true;

  return [
    "professional print",
    "printing",
    "ship now",
    "menu coffee",
    "menu",
  ].some((pattern) => normalized.includes(pattern));
};

const cleanOcrMenuText = (text = "") => {
  const dedupedLines = [];
  const seenLines = new Set();

  for (const line of normalizeOcrText(text)
    .split("\n")
    .map((line) => normalizeOcrLine(line))
    .filter((line) => line.length >= 2)
    .filter((line) => !isLikelyWatermarkLine(line))
    .filter((line) => isUsefulOcrMenuLine(line))) {
    const key = line.toLowerCase();
    if (seenLines.has(key)) continue;
    seenLines.add(key);
    dedupedLines.push(line);
  }

  return dedupedLines.join("\n");
};

const extractUsefulOcrLines = (text = "") => {
  return cleanOcrMenuText(text)
    .split("\n")
    .map((line) => normalizeOcrLine(line))
    .filter(Boolean);
};

const isMeaningfulOcrText = (text = "") => {
  const normalized = normalizeOcrText(text);
  if (!normalized) return false;
  if (looksLikeConversationalOcrFailure(normalized)) return false;

  const alphaCount = (normalized.match(/[A-Za-zÀ-ỹà-ỹ]/g) || []).length;
  const digitCount = (normalized.match(/\d/g) || []).length;
  const lineCount = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;

  return alphaCount >= 20 && digitCount >= 3 && lineCount >= 4;
};

const createOcrWorker = async () => {
  const worker = await createWorker(["eng", "vie"], 1, {
    langPath: OCR_DATA_PATH,
    gzip: false,
  });

  await worker.setParameters({
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  return worker;
};

const buildPreprocessedImage = async (imageBuffer) => {
  const baseImage = sharp(imageBuffer, { failOn: "none" }).rotate();
  const metadata = await baseImage.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (!width || !height) {
    throw new Error("Invalid image metadata");
  }

  const targetWidth = Math.max(width * 2, 1800);

  return baseImage
    .resize({ width: targetWidth, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen()
    .threshold(170)
    .png()
    .toBuffer();
};

const buildContrastImage = async (imageBuffer, { crop = null, grayscale = false, threshold = null } = {}) => {
  let pipeline = sharp(imageBuffer, { failOn: "none" }).rotate();

  if (crop) {
    pipeline = pipeline.extract(crop);
  }

  const metadata = await pipeline.metadata();
  const width = metadata.width || 0;
  if (!width) {
    throw new Error("Invalid image metadata");
  }

  pipeline = pipeline.resize({
    width: Math.max(width * 3, 2200),
    withoutEnlargement: false,
  });

  if (grayscale) {
    pipeline = pipeline.grayscale();
  }

  pipeline = pipeline.normalize().sharpen();

  if (threshold !== null) {
    pipeline = pipeline.threshold(threshold);
  }

  return pipeline.png().toBuffer();
};

const splitImageIntoColumns = async (imageBuffer, columnCount = 2) => {
  const image = sharp(imageBuffer, { failOn: "none" });
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (!width || !height || columnCount <= 1) {
    return [imageBuffer];
  }

  const overlap = Math.round(width * 0.02);
  const columnWidth = Math.floor(width / columnCount);
  const columns = [];

  for (let index = 0; index < columnCount; index += 1) {
    const left = Math.max(0, index * columnWidth - overlap);
    const rightBoundary =
      index === columnCount - 1 ? width : Math.min(width, (index + 1) * columnWidth + overlap);
    const extractWidth = Math.max(1, rightBoundary - left);

    columns.push(
      await image
        .clone()
        .extract({
          left,
          top: 0,
          width: extractWidth,
          height,
        })
        .png()
        .toBuffer()
    );
  }

  return columns;
};

const recognizeImageBuffer = async (worker, imageBuffer, pageSegMode, whitelist = "") => {
  await worker.setParameters({
    tessedit_pageseg_mode: pageSegMode ? String(pageSegMode) : String(PSM.AUTO),
    tessedit_char_whitelist: whitelist,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const {
    data: { text },
  } = await worker.recognize(imageBuffer);

  return cleanOcrMenuText(text);
};

const parsePriceCandidates = (text = "") => {
  return String(text || "")
    .match(/\d{1,3}\s*(?:k|K)|\d{1,3}(?:[.,]\d{3})+/g)
    ?.map((value) => {
      const normalized = String(value).trim();
      if (/k$/i.test(normalized)) {
        return Number(normalized.replace(/[^\d]/g, "")) * 1000;
      }

      return Number(normalized.replace(/[^\d]/g, ""));
    })
    .filter((value) => Number.isFinite(value) && value >= 5000 && value <= 500000) || [];
};

const extractPriceListFromImageBuffer = async (worker, imageBuffer) => {
  await worker.setParameters({
    tessedit_pageseg_mode: String(PSM.SPARSE_TEXT),
    tessedit_char_whitelist: "0123456789kK.,",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const {
    data: { text },
  } = await worker.recognize(imageBuffer);

  return parsePriceCandidates(normalizeOcrText(text));
};

const parseOrderWithOllama = async (text) => {
  const prompt = `
Ban la AI ho tro POS ban do an va thuc uong.

Nhiem vu:
Phan tich cau nguoi dung thanh JSON don hang.

Chi tra ve JSON hop le, khong giai thich, khong markdown.

Schema bat buoc:
{
  "customer_name": "",
  "order_type": "takeaway",
  "payment_method": "cash",
  "items": [
    {
      "name": "",
      "quantity": 1,
      "option": "",
      "toppings": [],
      "note": ""
    }
  ]
}

Quy tac:
- order_type chi duoc la: "dine_in", "takeaway", "delivery"
- payment_method chi duoc la: "cash", "banking", "card", "momo", "vnpay", "debt"
- Neu khong thay khach hang thi customer_name = ""
- Neu khong thay phuong thuc thanh toan thi payment_method = "cash"
- Neu khong thay loai don thi order_type = "takeaway"
- Neu khong thay size thi option = ""
- toppings la mang string
- quantity phai la so
- Khong tu bia mon khong co trong cau

Vi du:
Input: "2 cà phê sữa size L, 1 trà đào thêm trân châu đen"
Output:
{
  "customer_name": "",
  "order_type": "takeaway",
  "payment_method": "cash",
  "items": [
    {
      "name": "cà phê sữa",
      "quantity": 2,
      "option": "Size L",
      "toppings": [],
      "note": ""
    },
    {
      "name": "trà đào",
      "quantity": 1,
      "option": "",
      "toppings": ["trân châu đen"],
      "note": ""
    }
  ]
}

Luu y:
- Khong dua size vao name.
- Khong dua topping vao name.
- name chi la ten mon chinh.
- Topping dung sau mon nao thi gan cho mon do.

Cau nguoi dung:
${text}
`;

  const response = await axios.post(`${process.env.OLLAMA_URL}/api/chat`, {
    model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: false,
  });

  const content = response.data?.message?.content;

  if (!content) {
    throw new Error("AI does not return content");
  }

  return content;
};

const buildParseMenuPrompt = ({ text = "", fileName = "", prompt = "" }) => `
Ban la AI ho tro POS cho quan do an va thuc uong.

Nhiem vu:
- Doc noi dung menu duoc cung cap.
- Tach danh sach mon de co the import vao he thong POS.
- Chi tra ve JSON hop le, khong markdown, khong giai thich.

Schema bat buoc:
{
  "items": [
    {
      "name": "",
      "product_type": "drink",
      "category_name": "",
      "selling_price": 0,
      "cost_price": 0,
      "unit": "",
      "description": "",
      "allow_topping": false,
      "allow_size": false,
      "aliases": [],
      "source_text": "",
      "options": [
        {
          "option_name": "",
          "extra_price": 0
        }
      ]
    }
  ]
}

Quy tac:
- product_type chi duoc la "food", "drink", hoac "combo"
- selling_price va cost_price phai la so
- aliases la mang string, bo trung lap
- options la mang object, moi item co option_name va extra_price
- source_text bat buoc la chuoi trich nguyen van tu file/hinh da cung cap de chung minh mon nay thuc su ton tai
- Neu khong chac gia, dat selling_price = 0
- Neu khong co category_name thi de ""
- Neu mon co size S/M/L thi dua vao options va dat allow_size = true
- Neu mon la do uong mac dinh unit = "ly"
- Neu mon la do an mac dinh unit = "phan"
- Neu mon la combo mac dinh unit = "combo"
- Tuyet doi khong tao them mon khong co trong noi dung file/hinh
- Khong duoc suy doan, khong duoc tu bo sung menu mau, khong duoc viet ra mon pho bien neu khong nhin thay trong noi dung
- Neu khong doc ro ten mon thi bo qua mon do
- Moi item phai co bang chung trong source_text; neu khong tim duoc bang chung thi khong tra ve item do
- Neu menu co tieu de nhom nhu "Tra sua", "Ca phe", "Mon an", co the dua vao category_name

Ten file: ${fileName || "menu-upload"}
Huong dan bo sung: ${prompt || "Khong co"}

Noi dung menu:
${text}
`;

const parseMenuTextWithOllama = async ({ text, fileName, prompt }) => {
  const response = await axios.post(`${process.env.OLLAMA_URL}/api/chat`, {
    model: process.env.OLLAMA_MENU_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:3b",
    messages: [
      {
        role: "user",
        content: buildParseMenuPrompt({ text, fileName, prompt }),
      },
    ],
    stream: false,
  });

  const content = response.data?.message?.content;

  if (!content) {
    throw new Error("AI does not return content");
  }

  return content;
};

const parseMenuImageWithOllama = async ({ imageBase64, mimeType, fileName, prompt }) => {
  const visionModel =
    process.env.OLLAMA_VISION_MODEL ||
    process.env.OLLAMA_MENU_VISION_MODEL ||
    process.env.OLLAMA_MODEL ||
    "llava:latest";

  if (!visionModel) {
    throw new Error("Vision model is not configured");
  }

  const response = await axios.post(`${process.env.OLLAMA_URL}/api/chat`, {
    model: visionModel,
    messages: [
      {
        role: "user",
        content: `${buildParseMenuPrompt({
          text: "Hay doc thong tin tren hinh menu dinh kem.",
          fileName,
          prompt,
        })}\nMime type: ${mimeType}`,
        images: [imageBase64],
      },
    ],
    stream: false,
  });

  const content = response.data?.message?.content;

  if (!content) {
    throw new Error("AI does not return content");
  }

  return content;
};

const extractMenuTextFromImageWithOllama = async ({ imageBase64, mimeType, fileName }) => {
  void mimeType;
  void fileName;

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const trimmedImage = await sharp(imageBuffer, { failOn: "none" })
    .rotate()
    .trim({ threshold: 20 })
    .png()
    .toBuffer();
  const preprocessedImage = await buildPreprocessedImage(trimmedImage);
  const originalMetadata = await sharp(trimmedImage).metadata();
  const originalWidth = originalMetadata.width || 0;
  const originalHeight = originalMetadata.height || 0;
  const centerCrop =
    originalWidth && originalHeight
      ? {
          left: Math.max(0, Math.round(originalWidth * 0.08)),
          top: Math.max(0, Math.round(originalHeight * 0.12)),
          width: Math.max(1, Math.round(originalWidth * 0.84)),
          height: Math.max(1, Math.round(originalHeight * 0.78)),
        }
      : null;
  const grayImage = await buildContrastImage(trimmedImage, {
    grayscale: true,
    threshold: null,
  });
  const thresholdImage = await buildContrastImage(trimmedImage, {
    grayscale: true,
    threshold: 150,
  });
  const centerGrayImage = centerCrop
    ? await buildContrastImage(trimmedImage, {
        crop: centerCrop,
        grayscale: true,
        threshold: null,
      })
    : grayImage;
  const colorImage = await buildContrastImage(trimmedImage, {
    grayscale: false,
    threshold: null,
  });
  const columnImages = await splitImageIntoColumns(grayImage, 2);
  const worker = await createOcrWorker();

  try {
    const fullImageText = await recognizeImageBuffer(worker, preprocessedImage, PSM.AUTO);
    const sparseColorText = await recognizeImageBuffer(worker, colorImage, PSM.SPARSE_TEXT);
    const sparseThresholdText = await recognizeImageBuffer(worker, thresholdImage, PSM.SPARSE_TEXT);
    const centerSparseText = await recognizeImageBuffer(worker, centerGrayImage, PSM.SPARSE_TEXT);
    const combinedPriceCandidates = [
      ...parsePriceCandidates(sparseColorText),
      ...parsePriceCandidates(sparseThresholdText),
      ...parsePriceCandidates(centerSparseText),
    ];
    const columnResults = [];

    for (const columnImage of columnImages) {
      const columnText = await recognizeImageBuffer(worker, columnImage, PSM.SINGLE_COLUMN);
      const columnMetadata = await sharp(columnImage).metadata();
      const columnWidth = columnMetadata.width || 0;
      const columnHeight = columnMetadata.height || 0;
      const priceRegionLeft = Math.floor(columnWidth * 0.72);
      const priceRegion = await sharp(columnImage)
        .extract({
          left: priceRegionLeft,
          top: 0,
          width: Math.max(1, columnWidth - priceRegionLeft),
          height: columnHeight,
        })
        .png()
        .toBuffer();
      const prices = await extractPriceListFromImageBuffer(worker, priceRegion);

      columnResults.push({
        text: columnText,
        lines: extractUsefulOcrLines(columnText),
        prices,
      });
    }

    const mergedColumnText = cleanOcrMenuText(columnResults.map((item) => item.text).join("\n\n"));
    const mergedSparseText = cleanOcrMenuText(
      [sparseColorText, sparseThresholdText, centerSparseText].filter(Boolean).join("\n\n")
    );
    const fallbackText = cleanOcrMenuText(
      [mergedColumnText, fullImageText, mergedSparseText].filter(Boolean).join("\n\n")
    );
    if (!isMeaningfulOcrText(fallbackText)) {
      return {
        text: "OCR_FAILED",
        columns: [],
      };
    }

    return {
      text: isMeaningfulOcrText(mergedSparseText)
        ? cleanOcrMenuText([mergedSparseText, mergedColumnText].filter(Boolean).join("\n\n"))
        : fallbackText,
      lines: extractUsefulOcrLines(
        isMeaningfulOcrText(mergedSparseText)
          ? cleanOcrMenuText([mergedSparseText, mergedColumnText].filter(Boolean).join("\n\n"))
          : fallbackText
      ),
      globalPrices: [...new Set(combinedPriceCandidates)],
      columns: columnResults.map((column) => ({
        ...column,
        prices: [...new Set([...(column.prices || [])])],
      })),
    };
  } finally {
    await worker.terminate();
  }
};

const parseOrderByAI = async (text) => {
  const provider = process.env.AI_PROVIDER || "ollama";

  if (provider === "ollama") {
    const rawResult = await parseOrderWithOllama(text);
    return extractJsonFromText(rawResult);
  }

  throw new Error("Unsupported AI provider");
};

const parseMenuByAI = async (payload) => {
  const provider = process.env.AI_PROVIDER || "ollama";

  if (provider !== "ollama") {
    throw new Error("Unsupported AI provider");
  }

  if (payload.type === "text") {
    const rawResult = await parseMenuTextWithOllama(payload);
    return extractJsonFromText(rawResult);
  }

  if (payload.type === "image") {
    const rawResult = await parseMenuImageWithOllama(payload);
    return extractJsonFromText(rawResult);
  }

  throw new Error("Unsupported menu input type");
};

const askBusinessWithOllama = async (question, businessData) => {
  const prompt = `
Bạn là trợ lý AI quản lý cửa hàng F&B POS.

Nhiệm vụ:
Dựa vào dữ liệu hệ thống bên dưới để trả lời câu hỏi của quản lý.
Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng, có số liệu cụ thể.
Không bịa dữ liệu ngoài phần được cung cấp.

Câu hỏi:
${question}

Dữ liệu hệ thống:
${JSON.stringify(businessData, null, 2)}
`;

  const response = await axios.post(`${process.env.OLLAMA_URL}/api/chat`, {
    model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: false,
  });

  const content = response.data?.message?.content;

  if (!content) {
    throw new Error("AI does not return content");
  }

  return content;
};

const askBusinessWithOllamaV2 = async (question, businessContext) => {
  const prompt = `
Ban la tro ly AI quan ly cua hang F&B POS.

Nhiem vu:
- Dua vao du lieu he thong duoc cung cap de tra loi cau hoi cua quan ly.
- Tra loi bang tieng Viet, ngan gon, ro rang, uu tien so lieu cu the.
- Neu cau hoi co lien quan den thoi gian, hay dua ra dung ky du lieu trong context.
- Neu du lieu khong du de ket luan, hay noi ro "khong du du lieu".
- Khong duoc tu bo sung so lieu ngoai context.

Huong dan tra loi:
- Neu nguoi dung hoi tong quan, hay tom tat 2-4 y chinh nhat.
- Neu nguoi dung hoi so sanh, hay chi ra muc cao nhat hoac thap nhat neu co.
- Neu nguoi dung hoi ve doanh thu, co the de cap tong doanh thu, so don, gia tri don trung binh, no va co cau thanh toan neu co trong du lieu.
- Neu nguoi dung hoi ve van hanh, co the de cap top mon, ton kho, bep, don huy, cong no, loai don, khach hang tuy theo du lieu co san.

Cau hoi:
${question}

Context he thong:
${JSON.stringify(businessContext, null, 2)}
`;

  const response = await axios.post(`${process.env.OLLAMA_URL}/api/chat`, {
    model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: false,
  });

  const content = response.data?.message?.content;

  if (!content) {
    throw new Error("AI does not return content");
  }

  return content;
};

module.exports = {
  parseOrderByAI,
  parseMenuByAI,
  extractMenuTextFromImageWithOllama,
  askBusinessWithOllama: askBusinessWithOllamaV2,
};
