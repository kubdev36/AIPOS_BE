const prisma = require("../config/prisma");
const {
  parseOrderByAI,
  extractMenuTextFromImageWithOllama,
  parseMenuByAI,
} = require("../services/ai.service");

const normalizeText = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase();
};

const toSearchKey = (value) => {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const cleanProductName = (name) => {
  return normalizeText(name)
    .replace(/size\s*(s|m|l|xl)/gi, "")
    .replace(/(^|\s)(s|m|l|xl)(?=\s|$)/gi, " ")
    .replace(/th\u00eam.*/gi, "")
    .replace(/\u00edt \u0111\u00e1/gi, "")
    .replace(/nhi\u1ec1u \u0111\u00e1/gi, "")
    .replace(/\u00edt \u0111\u01b0\u1eddng/gi, "")
    .replace(/nhi\u1ec1u \u0111\u01b0\u1eddng/gi, "")
    .replace(/\s+/g, " ")
    .trim();
};

const findProductByNameOrAlias = async (tx, name) => {
  const rawName = normalizeText(name);
  const searchName = cleanProductName(name);
  const rawKey = toSearchKey(rawName);
  const searchKey = toSearchKey(searchName);

  if (!searchName || !searchKey) return null;

  let product = await tx.products.findFirst({
    where: {
      status: true,
      name: {
        equals: searchName,
        mode: "insensitive",
      },
    },
  });

  if (product) return product;

  const alias = await tx.product_aliases.findFirst({
    where: {
      alias_name: {
        equals: searchName,
        mode: "insensitive",
      },
    },
  });

  if (alias) {
    return tx.products.findFirst({
      where: {
        id: alias.product_id,
        status: true,
      },
    });
  }

  product = await tx.products.findFirst({
    where: {
      status: true,
      OR: [
        {
          name: {
            contains: searchName,
            mode: "insensitive",
          },
        },
        {
          name: {
            contains: rawName,
            mode: "insensitive",
          },
        },
      ],
    },
  });

  if (product) return product;

  const aliasContains = await tx.product_aliases.findFirst({
    where: {
      alias_name: {
        contains: searchName,
        mode: "insensitive",
      },
    },
  });

  if (aliasContains) {
    return tx.products.findFirst({
      where: {
        id: aliasContains.product_id,
        status: true,
      },
    });
  }

  const products = await tx.products.findMany({
    where: {
      status: true,
    },
  });

  const exactProduct = products.find((item) => {
    const productKey = toSearchKey(item.name);
    return productKey === searchKey || productKey === rawKey;
  });

  if (exactProduct) return exactProduct;

  const containsProduct = products.find((item) => {
    const productKey = toSearchKey(item.name);
    return productKey.includes(searchKey) || searchKey.includes(productKey);
  });

  if (containsProduct) return containsProduct;

  const aliases = await tx.product_aliases.findMany();
  const productMap = new Map(products.map((item) => [item.id, item]));

  const exactAlias = aliases.find((item) => {
    const aliasKey = toSearchKey(item.alias_name);
    return aliasKey === searchKey || aliasKey === rawKey;
  });

  if (exactAlias) {
    return productMap.get(exactAlias.product_id) || null;
  }

  const containsAlias = aliases.find((item) => {
    const aliasKey = toSearchKey(item.alias_name);
    return aliasKey.includes(searchKey) || searchKey.includes(aliasKey);
  });

  if (containsAlias) {
    return productMap.get(containsAlias.product_id) || null;
  }

  return null;
};

const extractSizeFromText = (text) => {
  const value = normalizeText(text);

  if (value.includes("size l") || value.endsWith(" l")) return "Size L";
  if (value.includes("size m") || value.endsWith(" m")) return "Size M";
  if (value.includes("size s") || value.endsWith(" s")) return "Size S";
  if (value.includes("size xl") || value.endsWith(" xl")) return "Size XL";

  return "";
};

const findOptionByName = async (tx, productId, optionName, productText = "") => {
  let searchOption = normalizeText(optionName);

  if (!searchOption) {
    searchOption = normalizeText(extractSizeFromText(productText));
  }

  if (!searchOption) return null;

  let option = await tx.product_options.findFirst({
    where: {
      product_id: productId,
      status: true,
      option_name: {
        equals: searchOption,
        mode: "insensitive",
      },
    },
  });

  if (option) return option;

  const searchKey = toSearchKey(searchOption);
  const options = await tx.product_options.findMany({
    where: {
      product_id: productId,
      status: true,
    },
  });

  option = options.find((item) => toSearchKey(item.option_name) === searchKey);

  if (option) return option;

  return (
    options.find((item) => {
      const optionKey = toSearchKey(item.option_name);
      return optionKey.includes(searchKey) || searchKey.includes(optionKey);
    }) || null
  );
};

const findToppingsByNames = async (tx, toppingNames = []) => {
  const results = [];
  const activeToppings = await tx.toppings.findMany({
    where: {
      status: true,
    },
  });

  for (const toppingName of toppingNames) {
    const searchTopping = normalizeText(toppingName);
    const searchKey = toSearchKey(toppingName);

    if (!searchTopping || !searchKey) continue;

    let topping = await tx.toppings.findFirst({
      where: {
        status: true,
        name: {
          equals: searchTopping,
          mode: "insensitive",
        },
      },
    });

    if (!topping) {
      topping =
        activeToppings.find((item) => toSearchKey(item.name) === searchKey) ||
        activeToppings.find((item) => {
          const toppingKey = toSearchKey(item.name);
          return toppingKey.includes(searchKey) || searchKey.includes(toppingKey);
        }) ||
        null;
    }

    if (topping) {
      results.push(topping);
    }
  }

  return results;
};

const supportedTextMimeTypes = new Set([
  "text/plain",
  "text/csv",
  "application/json",
]);

const supportedImageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const parseBooleanValue = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    return ["true", "1", "yes", "co", "có"].includes(normalized);
  }

  return false;
};

const normalizeAliases = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }

  return [...new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean))];
};

const normalizeOptions = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      option_name: String(item?.option_name || item?.name || "").trim(),
      extra_price: Number(item?.extra_price || item?.price || 0),
    }))
    .filter((item) => item.option_name);
};

const normalizeProductType = (value) => {
  const normalized = normalizeText(value);

  if (["food", "drink", "combo"].includes(normalized)) {
    return normalized;
  }

  if (normalized.includes("an") || normalized.includes("food")) {
    return "food";
  }

  if (normalized.includes("combo")) {
    return "combo";
  }

  return "drink";
};

const MENU_NAME_HINTS = [
  "ca phe",
  "coffee",
  "bac xiu",
  "nau da",
  "sua tuoi",
  "den da",
  "coldbrew",
  "tra",
  "tac",
  "muoi",
  "latte",
  "espresso",
  "cappuccino",
  "milk tea",
  "soda",
  "juice",
  "smoothie",
];

const looksLikeCleanMenuName = (value = "") => {
  const normalized = toSearchKey(value);
  if (!normalized) return false;
  if (normalized.length < 4) return false;
  if (/[|@\\/<>{}]/.test(String(value || ""))) return false;
  if (/^topping\b/i.test(normalized)) return false;
  if (["coffee", "menu", "coffe"].includes(normalized)) return false;

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 1 && tokens[0].length < 6) return false;
  if (tokens.some((token) => token.length === 1)) return false;

  return (
    MENU_NAME_HINTS.some((hint) => normalized.includes(hint)) ||
    tokens.filter((token) => token.length >= 3).length >= 2
  );
};

const defaultUnitByType = (productType) => {
  if (productType === "food") return "phan";
  if (productType === "combo") return "combo";
  return "ly";
};

const mergeAiHintsIntoDetectedItems = (baseItems = [], aiHintItems = []) => {
  if (!Array.isArray(baseItems) || baseItems.length === 0 || !Array.isArray(aiHintItems) || aiHintItems.length === 0) {
    return baseItems;
  }

  return baseItems.map((baseItem) => {
    const baseKey = toSearchKey(baseItem?.name);
    if (!baseKey) return baseItem;

    const matchedHint = aiHintItems.find((hintItem) => {
      const hintKey = toSearchKey(hintItem?.name);
      if (!hintKey) return false;
      return hintKey === baseKey || hintKey.includes(baseKey) || baseKey.includes(hintKey);
    });

    if (!matchedHint) {
      return baseItem;
    }

    return {
      ...baseItem,
      name: matchedHint.name || baseItem.name,
      category_name: matchedHint.category_name || baseItem.category_name,
      selling_price:
        Number(baseItem?.selling_price || 0) > 0
          ? baseItem.selling_price
          : Number(matchedHint?.selling_price || 0),
      cost_price:
        Number(baseItem?.cost_price || 0) > 0 ? baseItem.cost_price : Number(matchedHint?.cost_price || 0),
      description: baseItem.description || matchedHint.description || "",
      allow_topping: Boolean(baseItem.allow_topping || matchedHint.allow_topping),
      allow_size: Boolean(baseItem.allow_size || matchedHint.allow_size),
      aliases: Array.from(new Set([...(baseItem.aliases || []), ...(matchedHint.aliases || [])])),
      options: Array.isArray(baseItem.options) && baseItem.options.length > 0 ? baseItem.options : matchedHint.options || [],
      vision_detected: Boolean(matchedHint.vision_detected),
    };
  });
};

const detectFileExtension = (fileName = "") => {
  const normalized = String(fileName || "").trim().toLowerCase();
  const extension = normalized.split(".").pop();
  return extension && extension !== normalized ? extension : "";
};

const toNumberOrZero = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value || "").trim();
  if (!raw) return 0;

  const normalized = raw.replace(/[^\d.,-]/g, "");
  if (!normalized) return 0;

  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(normalized)) {
    const parsedThousands = Number(normalized.replace(/[.,]/g, ""));
    return Number.isFinite(parsedThousands) ? parsedThousands : 0;
  }

  const shorthandThousandsMatch = normalized.match(/^(\d{1,3})[.,](0{1,2})$/);
  if (shorthandThousandsMatch) {
    const parsedThousands = Number(shorthandThousandsMatch[1]) * 1000;
    return Number.isFinite(parsedThousands) ? parsedThousands : 0;
  }

  const parsed = Number(
    normalized
      .replace(/\.(?=.*\.)/g, "")
      .replace(",", ".")
  );

  return Number.isFinite(parsed) ? parsed : 0;
};

const dedupeMenuItems = (items = []) => {
  const itemMap = new Map();

  for (const item of items) {
    const key = [
      toSearchKey(item?.name),
      toSearchKey(item?.category_name),
      Number(item?.selling_price || 0),
    ].join("|");

    if (!key || key === "||0") continue;
    if (!itemMap.has(key)) {
      itemMap.set(key, item);
    }
  }

  return Array.from(itemMap.values());
};

const inferProductTypeFromText = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) return "drink";
  if (/(combo|set)/i.test(normalized)) return "combo";
  if (/(com|mi|pho|bun|hu tieu|chao|sup|banh|mon an|food)/i.test(normalized)) {
    return "food";
  }

  return "drink";
};

const inferCategoryFromLine = (line = "") => {
  const parts = String(line || "")
    .split(/[-:|]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length >= 2 && parts[0].length <= 40) {
    return parts[0];
  }

  return "";
};

const sanitizeMenuLine = (line = "") => {
  return String(line || "")
    .replace(/[._]{2,}/g, " ")
    .replace(/[“”"`~^]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const isLikelyWatermarkLine = (line = "") => {
  const normalized = sanitizeMenuLine(line).toLowerCase();

  if (!normalized) return true;

  return [
    "professional print",
    "printing",
    "ship now",
    "menu coffee",
    "menu",
  ].some((pattern) => normalized.includes(pattern));
};

const sanitizeMenuName = (value = "") => {
  return String(value || "")
    .replace(/^[|/\\\-_=+:;,.()\[\]{}'"]+/g, "")
    .replace(/[|/\\\-_=+:;,.()\[\]{}'"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const isReasonableMenuItemName = (value = "") => {
  const normalized = sanitizeMenuName(value);
  if (!normalized) return false;
  if (normalized.length < 3 && !/\d/.test(normalized)) return false;
  if (/(minh khang|printing)/i.test(normalized)) return false;
  if ((normalized.match(/[A-Za-zÀ-ỹà-ỹ0-9]/g) || []).length < 3) return false;
  if ((normalized.match(/[^\w\sÀ-ỹ]/g) || []).length >= 3) return false;

  return true;
};

const extractStandalonePrice = (line = "") => {
  const normalized = sanitizeMenuLine(line);
  const match = normalized.match(/^(\d[\d.,]*)\s*(k|000|vnd|vnđ|d)?$/i);

  if (!match) return null;

  let value = toNumberOrZero(match[1]);
  if (/k$/i.test(match[0]) && value > 0 && value < 1000) {
    value *= 1000;
  }

  return value > 0 ? value : null;
};

const isLikelyCategoryHeading = (line = "") => {
  const normalized = sanitizeMenuLine(line);

  if (!normalized || /\d/.test(normalized)) return false;
  if (normalized.length > 30) return false;
  if ((normalized.match(/\s+/g) || []).length < 1) return false;
  if ((normalized.match(/[|/\\_=~`]/g) || []).length > 0) return false;

  const upperChars = (normalized.match(/[A-ZÀ-Ỹ]/g) || []).length;
  const alphaChars = (normalized.match(/[A-Za-zÀ-ỹà-ỹ]/g) || []).length;

  return alphaChars > 0 && upperChars / alphaChars >= 0.5;
};

const isLikelyMenuName = (line = "") => {
  const normalized = sanitizeMenuLine(line);

  if (!normalized) return false;
  if (normalized.length < 2 || normalized.length > 80) return false;
  if (/\d/.test(normalized)) return false;
  if (/^\(.*\)$/.test(normalized)) return false;
  if (/(whipping cream|her coffee|professional print|printing|ship now)$/i.test(normalized)) {
    return false;
  }
  if ((normalized.match(/[|/\\_=~`]/g) || []).length >= 2) return false;

  return /[A-Za-zÀ-ỹà-ỹ]/.test(normalized);
};

const buildDeterministicMenuItem = (item, sourceText = "") => {
  const productType = normalizeProductType(
    item?.product_type || inferProductTypeFromText(item?.category_name || item?.name || sourceText)
  );
  const options = normalizeOptions(item?.options);

  return {
    name: String(item?.name || item?.product_name || item?.title || "").trim(),
    product_type: productType,
    category_name: String(item?.category_name || item?.category || "").trim(),
    selling_price: Number(item?.selling_price || item?.price || item?.unit_price || 0),
    cost_price: Number(item?.cost_price || 0),
    unit: String(item?.unit || defaultUnitByType(productType)).trim(),
    description: String(item?.description || "").trim(),
    allow_topping: parseBooleanValue(item?.allow_topping),
    allow_size: parseBooleanValue(item?.allow_size) || options.length > 0,
    aliases: normalizeAliases(item?.aliases || item?.ai_aliases),
    source_text: String(item?.source_text || sourceText || "").trim(),
    inferred_price: Boolean(item?.inferred_price),
    price_source: String(item?.price_source || "").trim(),
    options,
  };
};

const applyFallbackPrices = (items = [], fallbackPrices = []) => {
  if (!Array.isArray(fallbackPrices) || fallbackPrices.length === 0) {
    return items;
  }

  const sanitizedFallbackPrices = fallbackPrices
    .map((price) => Number(price || 0))
    .filter((price) => Number.isFinite(price) && price >= 1000 && price <= 500000);

  if (sanitizedFallbackPrices.length === 0) {
    return items;
  }

  let priceIndex = 0;

  return items.map((item) => {
    if (Number(item?.selling_price || 0) > 0) {
      return item;
    }

    if (priceIndex >= sanitizedFallbackPrices.length) {
      return item;
    }

    const nextPrice = Number(sanitizedFallbackPrices[priceIndex] || 0);
    priceIndex += 1;

    if (!nextPrice) {
      return item;
    }

    return {
      ...item,
      selling_price: nextPrice,
      inferred_price: true,
      price_source: item?.price_source || "fallback",
    };
  });
};

const hasMeaningfulPriceInText = (text = "") => {
  return /(?:\d{1,3}(?:[.,]\d{3})+|\d+\s*(?:k|000|vnd|vnđ|d))/i.test(String(text || ""));
};

const parseJsonMenuItems = (text) => {
  try {
    const parsed = JSON.parse(text);
    const rawItems = Array.isArray(parsed)
      ? parsed
      : parsed?.items || parsed?.data?.items || parsed?.products || parsed?.data?.products || [];

    if (!Array.isArray(rawItems)) return [];

    return dedupeMenuItems(
      rawItems.map((item) => buildDeterministicMenuItem(item, JSON.stringify(item))).filter((item) => item.name)
    );
  } catch (error) {
    return [];
  }
};

const parseCsvMenuItems = (text) => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const splitRow = (line) =>
    line
      .split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/)
      .map((cell) => cell.trim().replace(/^"|"$/g, ""));

  const headers = splitRow(lines[0]).map((header) => toSearchKey(header));
  const rows = lines.slice(1);
  const items = rows
    .map((row) => {
      const cells = splitRow(row);
      const getValue = (...keys) => {
        const index = headers.findIndex((header) => keys.includes(header));
        return index >= 0 ? cells[index] : "";
      };

      const name = getValue("name", "ten mon", "ten", "product name", "product");
      if (!name) return null;

      return buildDeterministicMenuItem(
        {
          name,
          category_name: getValue("category", "category name", "danh muc", "nhom"),
          selling_price: toNumberOrZero(
            getValue("selling price", "selling_price", "price", "gia", "don gia")
          ),
          cost_price: toNumberOrZero(getValue("cost price", "cost_price", "gia von")),
          unit: getValue("unit", "don vi"),
          product_type: getValue("product type", "product_type", "loai"),
          description: getValue("description", "mo ta"),
          aliases: getValue("aliases", "alias", "ten khac"),
        },
        row
      );
    })
    .filter(Boolean);

  return dedupeMenuItems(items);
};

const parsePlainTextMenuItems = (text) => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => sanitizeMenuLine(line))
    .filter(Boolean)
    .filter((line) => !isLikelyWatermarkLine(line));

  const items = [];
  let currentCategory = "";
  let currentSharedPrice = 0;
  const pendingNames = [];

  const flushPendingNamesWithoutPrice = () => {
    while (pendingNames.length > 0) {
      const pendingName = sanitizeMenuName(pendingNames.shift());
      if (!isReasonableMenuItemName(pendingName)) continue;

      items.push(
        buildDeterministicMenuItem(
          {
            name: pendingName,
            category_name: currentCategory,
            selling_price: currentSharedPrice || 0,
            product_type: inferProductTypeFromText(`${currentCategory} ${pendingName}`),
          },
          pendingName
        )
      );
    }
  };

  for (const line of lines) {
    if (line.length < 3) continue;

    if (!currentSharedPrice && isLikelyCategoryHeading(line)) {
      flushPendingNamesWithoutPrice();
      currentCategory = line;
      currentSharedPrice = 0;
      continue;
    }

    const standalonePrice = extractStandalonePrice(line);
    if (standalonePrice !== null) {
      if (pendingNames.length > 0) {
        while (pendingNames.length > 0) {
          const pendingName = sanitizeMenuName(pendingNames.shift());
          if (!isReasonableMenuItemName(pendingName)) continue;

          items.push(
            buildDeterministicMenuItem(
              {
                name: pendingName,
                category_name: currentCategory,
                selling_price: standalonePrice,
                product_type: inferProductTypeFromText(`${currentCategory} ${pendingName}`),
              },
              `${pendingName} ${standalonePrice}`
            )
          );
        }
      } else {
        currentSharedPrice = standalonePrice;
      }
      continue;
    }

    const priceMatch = line.match(/(\d[\d.,]*)\s*(k|000|vnd|vnđ|d)?\s*$/i);
    if (!priceMatch) {
      if (isLikelyMenuName(line)) {
        const pendingName = sanitizeMenuName(line);
        if (isReasonableMenuItemName(pendingName)) {
          pendingNames.push(pendingName);
        }
      }
      continue;
    }

    const sellingPriceRaw = priceMatch[1];
    let sellingPrice = toNumberOrZero(sellingPriceRaw);
    if (/k$/i.test(priceMatch[0]) && sellingPrice > 0 && sellingPrice < 1000) {
      sellingPrice *= 1000;
    }

    const namePart = sanitizeMenuName(line.slice(0, priceMatch.index).replace(/[-:|]+$/g, "").trim());
    if (!namePart || namePart.length < 2) continue;

    const categoryName = inferCategoryFromLine(namePart) || currentCategory;
    const name = sanitizeMenuName(
      categoryName ? namePart.slice(categoryName.length).replace(/^[-:|]\s*/, "").trim() : namePart
    );

    if (!isReasonableMenuItemName(name)) continue;
    currentSharedPrice = 0;

    items.push(
      buildDeterministicMenuItem(
        {
          name,
          category_name: categoryName,
          selling_price: sellingPrice,
          product_type: inferProductTypeFromText(`${categoryName} ${name}`),
        },
        line
      )
    );
  }

  flushPendingNamesWithoutPrice();

  return dedupeMenuItems(items);
};

const normalizeMenuLines = (lines = []) => {
  return lines
    .map((line) => sanitizeMenuLine(line))
    .filter(Boolean)
    .filter((line) => !isLikelyWatermarkLine(line));
};

const extractTrailingPriceInfo = (line = "") => {
  const normalized = sanitizeMenuLine(line);
  const priceMatch = normalized.match(/(\d[\d.,]*)\s*(k|000|vnd|vnÄ‘|d)?\s*$/i);
  if (!priceMatch) return null;

  let sellingPrice = toNumberOrZero(priceMatch[1]);
  if (/k$/i.test(priceMatch[0]) && sellingPrice > 0 && sellingPrice < 1000) {
    sellingPrice *= 1000;
  }

  if (sellingPrice <= 0) {
    return null;
  }

  return {
    price: sellingPrice,
    namePart: sanitizeMenuName(normalized.slice(0, priceMatch.index).replace(/[-:|]+$/g, "").trim()),
  };
};

const stripTrailingPriceFromMenuText = (value = "") => {
  const priceInfo = extractTrailingPriceInfo(value);
  if (priceInfo?.namePart) {
    return priceInfo.namePart;
  }

  return sanitizeMenuName(
    String(value || "")
      .replace(/\s+\d[\d.,]*\s*(?:k|000|vnd|vnÄ‘|d)\s*$/i, "")
      .trim()
  );
};

const stripLeadingPriceFromMenuText = (value = "") => {
  return sanitizeMenuName(
    String(value || "")
      .replace(/^[\s|:;,.+-]*\d[\d.,]*\s*(?:k|000|vnd|vnÃ„â€˜|d)?\s*[-:|]?\s*/i, "")
      .trim()
  );
};

const normalizeMenuNameEvidence = (value = "") => {
  const original = sanitizeMenuName(value);
  if (!original) {
    return "";
  }

  const withoutLeadingPrice = stripLeadingPriceFromMenuText(original);
  const hadLeadingPrice = withoutLeadingPrice.length > 0 && withoutLeadingPrice !== original;
  const withoutTrailingPrice = stripTrailingPriceFromMenuText(withoutLeadingPrice || original);

  let cleaned = sanitizeMenuName(withoutTrailingPrice || withoutLeadingPrice || original);

  if (hadLeadingPrice) {
    cleaned = cleaned.replace(/^(?:[a-z]{1,2})\s+/i, "");
  }

  return sanitizeMenuName(cleaned);
};

const chooseBestMenuName = (rawName = "", sourceName = "") => {
  const normalizedRawName = normalizeMenuNameEvidence(rawName);
  const normalizedSourceName = normalizeMenuNameEvidence(sourceName);

  if (!normalizedRawName) return normalizedSourceName;
  if (!normalizedSourceName) return normalizedRawName;

  if (
    hasMeaningfulPriceInText(rawName) ||
    normalizedSourceName.length >= normalizedRawName.length + 4 ||
    (normalizedSourceName.includes(normalizedRawName) && normalizedSourceName !== normalizedRawName) ||
    (!looksLikeCleanMenuName(normalizedRawName) && looksLikeCleanMenuName(normalizedSourceName))
  ) {
    return normalizedSourceName;
  }

  return normalizedRawName;
};

const shouldMergeImageNameLines = (currentLine = "", nextLine = "", lineAfterNext = "") => {
  if (!currentLine || !nextLine) return false;
  if (hasMeaningfulPriceInText(currentLine) || hasMeaningfulPriceInText(nextLine)) return false;
  if (!isLikelyMenuName(currentLine) || !isLikelyMenuName(nextLine)) return false;
  if (!isReasonableMenuItemName(currentLine) || !isReasonableMenuItemName(nextLine)) return false;
  if (isLikelyCategoryHeading(nextLine)) return false;
  if (nextLine.length > 16) return false;

  const combined = sanitizeMenuName(`${currentLine} ${nextLine}`);
  if (!looksLikeCleanMenuName(combined) || combined.length > 42) return false;

  const nextKey = toSearchKey(nextLine);
  return (
    hasMeaningfulPriceInText(lineAfterNext) ||
    /(kem muoi|xi muoi|cacao|matcha|truyen thong|dac biet|tran chau|flan|sua|dao|vai|xoai|chanh|den|trang)$/i.test(
      nextKey
    )
  );
};

const mergeImageMenuLines = (lines = []) => {
  const mergedLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = sanitizeMenuLine(lines[index]);
    const nextLine = sanitizeMenuLine(lines[index + 1] || "");
    const lineAfterNext = sanitizeMenuLine(lines[index + 2] || "");

    if (shouldMergeImageNameLines(currentLine, nextLine, lineAfterNext)) {
      mergedLines.push(sanitizeMenuName(`${currentLine} ${nextLine}`));
      index += 1;
      continue;
    }

    mergedLines.push(currentLine);
  }

  return mergedLines;
};

const parseImageMenuItems = ({ text = "", textLines = [], fallbackPrices = [] }) => {
  const baseLines = Array.isArray(textLines) && textLines.length > 0 ? textLines : String(text || "").split(/\r?\n/);
  const lines = mergeImageMenuLines(normalizeMenuLines(baseLines));
  const items = [];
  let currentCategory = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.length < 2) continue;

    if (!hasMeaningfulPriceInText(line) && isLikelyCategoryHeading(line)) {
      currentCategory = line;
      continue;
    }

    const inlinePriceInfo = extractTrailingPriceInfo(line);
    if (inlinePriceInfo && inlinePriceInfo.namePart) {
      const categoryName = inferCategoryFromLine(inlinePriceInfo.namePart) || currentCategory;
      const name = sanitizeMenuName(
        categoryName
          ? inlinePriceInfo.namePart.slice(categoryName.length).replace(/^[-:|]\s*/, "").trim()
          : inlinePriceInfo.namePart
      );

      if (!isReasonableMenuItemName(name) || !looksLikeCleanMenuName(name)) {
        continue;
      }

      items.push(
        buildDeterministicMenuItem(
          {
            name,
            category_name: categoryName,
            selling_price: inlinePriceInfo.price,
            product_type: inferProductTypeFromText(`${categoryName} ${name}`),
            price_source: "inline",
          },
          line
        )
      );
      continue;
    }

    if (!isLikelyMenuName(line) || !isReasonableMenuItemName(line) || !looksLikeCleanMenuName(line)) {
      const standalonePrice = extractStandalonePrice(line);
      const previousItem = items[items.length - 1];

      if (standalonePrice !== null && previousItem && Number(previousItem?.selling_price || 0) <= 0) {
        previousItem.selling_price = standalonePrice;
        previousItem.price_source = "adjacent";
        previousItem.source_text = previousItem.source_text
          ? `${previousItem.source_text} ${line}`.trim()
          : line;
      }

      continue;
    }

    const nextLine = lines[index + 1] || "";
    const adjacentPrice = extractStandalonePrice(nextLine);

    if (adjacentPrice !== null) {
      items.push(
        buildDeterministicMenuItem(
          {
            name: line,
            category_name: currentCategory,
            selling_price: adjacentPrice,
            product_type: inferProductTypeFromText(`${currentCategory} ${line}`),
            price_source: "adjacent",
          },
          `${line} ${nextLine}`.trim()
        )
      );
      index += 1;
      continue;
    }

    items.push(
      buildDeterministicMenuItem(
        {
          name: line,
          category_name: currentCategory,
          product_type: inferProductTypeFromText(`${currentCategory} ${line}`),
        },
        line
      )
    );
  }

  return dedupeMenuItems(applyFallbackPrices(items, fallbackPrices));
};

const parseMenuTextDeterministically = ({ text, fileName = "", fallbackPrices = [] }) => {
  const extension = detectFileExtension(fileName);

  if (extension === "json") {
    return parseJsonMenuItems(text);
  }

  if (extension === "csv") {
    return parseCsvMenuItems(text);
  }

  const jsonItems = parseJsonMenuItems(text);
  if (jsonItems.length > 0) return jsonItems;

  const csvItems = parseCsvMenuItems(text);
  if (csvItems.length > 0) return csvItems;

  const parsedItems = parsePlainTextMenuItems(text);
  return applyFallbackPrices(parsedItems, fallbackPrices);
};

const extractImageMenuNameCandidates = (text = "") => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => sanitizeMenuLine(line))
    .filter(Boolean)
    .filter((line) => !isLikelyWatermarkLine(line))
    .filter((line) => !/^topping\b/i.test(line));

  const items = [];

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = sanitizeMenuName(lines[index]);
    const nextLine = sanitizeMenuName(lines[index + 1] || "");

    if (
      !isLikelyMenuName(currentLine) ||
      !isReasonableMenuItemName(currentLine) ||
      !looksLikeCleanMenuName(currentLine)
    ) {
      continue;
    }

    let mergedName = currentLine;

    if (
      nextLine &&
      !hasMeaningfulPriceInText(currentLine) &&
      !hasMeaningfulPriceInText(nextLine) &&
      isLikelyMenuName(nextLine) &&
      isReasonableMenuItemName(nextLine) &&
      looksLikeCleanMenuName(nextLine) &&
      nextLine.length <= 14 &&
      /(ca phe|kem muoi|xi muoi|muoi)$/i.test(toSearchKey(nextLine)) &&
      `${currentLine} ${nextLine}`.length <= 40
    ) {
      mergedName = `${currentLine} ${nextLine}`;
      index += 1;
    }

    items.push(
      buildDeterministicMenuItem(
        {
          name: mergedName,
          product_type: inferProductTypeFromText(mergedName),
        },
        mergedName
      )
    );
  }

  return dedupeMenuItems(items);
};

const normalizeSourceForMatch = (value) => {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

const OCR_NAME_CORRECTIONS = [
  { pattern: /(ca phe muoi|ca phe muoii|ca phe muodi|ca phe muoi.)/i, replacement: "Ca phe muoi" },
  { pattern: /(bac xiu kem muoi|bac xiu kem muoii|bac xiu kem muodi)/i, replacement: "Bac xiu kem muoi" },
  { pattern: /(nau da|na[u4] da)/i, replacement: "Nau da" },
  { pattern: /(sua tuoi ca phe|sua tuoi ca phee|sua tuoi.*ca phe|siva tuci.*ca phe)/i, replacement: "Sua tuoi ca phe" },
  { pattern: /(den da|den dg|den d4)/i, replacement: "Den da" },
  { pattern: /(coldbrew|cotdbrew)/i, replacement: "Coldbrew" },
  { pattern: /(tra tac xi muoi|tra tac xi muoii|tra tac xi muodi|tra t[a-z\\s]*xi m)/i, replacement: "Tra tac xi muoi" },
  { pattern: /(kem muoi|kem muoii|kem muodi)/i, replacement: "Kem muoi" },
  { pattern: /(ca phe da|ca phe đa|ca phe den)/i, replacement: "Cà phê đá" },
  { pattern: /(ca pee sea da|ca phe sea da|ca phe sua da|ca phe s?a da)/i, replacement: "Cà phê sữa đá" },
  { pattern: /(ca phe sea cacao|ca phe sua cacao)/i, replacement: "Cà phê sữa cacao" },
  { pattern: /(bag xil da|bac xiu da)/i, replacement: "Bạc xỉu đá" },
  { pattern: /(mieo dam|milo dam)/i, replacement: "Milo dầm" },
  { pattern: /(tran chal trang|tran chau trang)/i, replacement: "Trân châu trắng" },
  { pattern: /(tran chau den|tran chal den)/i, replacement: "Trân châu đen" },
  { pattern: /(banh flan|banh plan|bash plan)/i, replacement: "Bánh flan" },
  { pattern: /\bthach\b/i, replacement: "Thạch" },
  { pattern: /(tra dao|tra đao)/i, replacement: "Trà đào" },
  { pattern: /\bsocola\b/i, replacement: "Socola" },
  { pattern: /\bpepsi\b/i, replacement: "Pepsi" },
  { pattern: /(coca|cola)/i, replacement: "Coca" },
  { pattern: /\bsting\b/i, replacement: "Sting" },
  { pattern: /(redbull|reu[a-z.]*)/i, replacement: "Redbull" },
  { pattern: /\b7up\b|\bz1p\b|\bi1p\b/i, replacement: "7UP" },
  { pattern: /\bkiwi\b/i, replacement: "Kiwi" },
  { pattern: /\bdao\b/i, replacement: "Đào" },
  { pattern: /\bnho\b/i, replacement: "Nho" },
  { pattern: /\bdau\b/i, replacement: "Dâu" },
  { pattern: /\bbac ha\b|\bbac hà\b/i, replacement: "Bạc hà" },
  { pattern: /\bchanh day\b/i, replacement: "Chanh dây" },
  { pattern: /\bxoai\b|\bxoat\b/i, replacement: "Xoài" },
];

const OCR_CATEGORY_CORRECTIONS = [
  { pattern: /(ca phe|coffee|cafe)/i, replacement: "Ca phe" },
  { pattern: /(tra sua hong tra|hong tra)/i, replacement: "Trà sữa hồng trà" },
  { pattern: /(topping them|topping thêm)/i, replacement: "Topping thêm" },
  { pattern: /(siro da bao|siro đa bao)/i, replacement: "Siro đá bào" },
  { pattern: /(yogurt da bao|yogurt đa bao)/i, replacement: "Yogurt đá bào" },
  { pattern: /(giai khat)/i, replacement: "Giải khát" },
  { pattern: /(ca phe|cafe)/i, replacement: "Cà phê" },
];

const applyOcrPhraseCorrections = (value = "", corrections = []) => {
  const source = String(value || "").trim();
  const normalized = normalizeSourceForMatch(source);
  const normalizedWithoutPrice = normalizeSourceForMatch(
    source.replace(/\d[\d.,]*/g, " ").replace(/\b(vnd|vnđ|d|ly|l)\b/gi, " ")
  );

  if (!normalized && !normalizedWithoutPrice) {
    return {
      value: source,
      corrected: false,
    };
  }

  const matched = corrections.find(
    (item) => item.pattern.test(normalizedWithoutPrice || normalized) || item.pattern.test(normalized)
  );
  if (!matched) {
    return {
      value: source,
      corrected: false,
    };
  }

  return {
    value: matched.replacement,
    corrected:
      normalizeSourceForMatch(matched.replacement) !== normalized &&
      normalizeSourceForMatch(matched.replacement) !== normalizedWithoutPrice,
  };
};

const isMenuItemGrounded = (item, sourceText = "") => {
  const normalizedSource = normalizeSourceForMatch(sourceText);

  if (!normalizedSource) return false;

  const name = normalizeSourceForMatch(item?.name);
  const evidence = normalizeSourceForMatch(item?.source_text);

  if (evidence && normalizedSource.includes(evidence)) {
    return true;
  }

  if (!name) return false;

  if (normalizedSource.includes(name)) {
    return true;
  }

  return name
    .split(" ")
    .filter(Boolean)
    .every((token) => token.length <= 1 || normalizedSource.includes(token));
};

const hasDirectSourceEvidence = (item, sourceText = "") => {
  const normalizedSource = normalizeSourceForMatch(sourceText);
  const evidence = normalizeSourceForMatch(item?.source_text);
  const name = normalizeSourceForMatch(item?.name);

  if (evidence && normalizedSource.includes(evidence)) {
    return true;
  }

  return !!(name && normalizedSource.includes(name));
};

const annotateMenuItem = (item, { sourceText = "", uploadType = "text" } = {}) => {
  const rawName = String(item?.name || "").trim();
  const rawCategoryName = String(item?.category_name || "").trim();
  const rawSourceText = String(item?.source_text || "").trim();
  const sourceNameCandidate = normalizeMenuNameEvidence(rawSourceText);
  const bestNameCandidate = chooseBestMenuName(rawName, sourceNameCandidate);
  const baseNameForCorrection = bestNameCandidate || rawName || sourceNameCandidate;
  const directEvidence = hasDirectSourceEvidence(item, sourceText);
  const normalizedSourceEvidence = normalizeSourceForMatch(rawSourceText || rawName);

  const correctedName = applyOcrPhraseCorrections(baseNameForCorrection, OCR_NAME_CORRECTIONS);
  const correctedCategory = applyOcrPhraseCorrections(rawCategoryName, OCR_CATEGORY_CORRECTIONS);

  const reviewReasons = [];

  if (uploadType === "image" && !directEvidence) {
    reviewReasons.push("Khong tim thay bang chung OCR trung khop");
  }

  if (uploadType === "image" && correctedName.corrected) {
    reviewReasons.push("Ten mon da duoc chuan hoa tu OCR");
  }

  if (uploadType === "image" && correctedCategory.corrected) {
    reviewReasons.push("Danh muc da duoc chuan hoa tu OCR");
  }

  if (Number(item?.selling_price || 0) <= 0) {
    reviewReasons.push("Chua doc chac gia ban");
  }

  if (
    uploadType === "image" &&
    Number(item?.selling_price || 0) > 0 &&
    (Boolean(item?.inferred_price) ||
      item?.price_source === "fallback" ||
      (!hasMeaningfulPriceInText(rawSourceText) && item?.price_source !== "inline" && item?.price_source !== "adjacent"))
  ) {
    reviewReasons.push("Gia ban duoc suy ra tu OCR, can doi chieu");
  }

  if (uploadType === "image" && /[~`|_=/\\]/.test(rawName + rawCategoryName + rawSourceText)) {
    reviewReasons.push("Van con ky tu nhieu OCR");
  }

  if (uploadType === "image" && normalizedSourceEvidence.length < 4) {
    reviewReasons.push("Bang chung OCR qua ngan");
  }

  const finalName = sanitizeMenuName(correctedName.value || bestNameCandidate || rawName || sourceNameCandidate);
  const finalCategoryName = correctedCategory.value || rawCategoryName;

  return {
    ...item,
    name: finalName,
    category_name: finalCategoryName,
    ocr_corrected: correctedName.corrected || correctedCategory.corrected,
    needs_review: reviewReasons.length > 0 || Boolean(item?.vision_detected && !directEvidence),
    review_reasons: [...new Set(reviewReasons)],
    direct_source_evidence: directEvidence,
  };
};

const normalizeMenuItems = (aiResult) => {
  const rawItems =
    aiResult?.items ||
    aiResult?.data?.items ||
    aiResult?.products ||
    aiResult?.data?.products ||
    [];

  if (!Array.isArray(rawItems)) {
    throw new Error("AI did not return item list");
  }

  return rawItems
    .map((item) => {
      const productType = normalizeProductType(item?.product_type);
      const options = normalizeOptions(item?.options);

      return {
        name: String(item?.name || item?.product_name || item?.title || "").trim(),
        product_type: productType,
        category_name: String(item?.category_name || item?.category || "").trim(),
        selling_price: Number(item?.selling_price || item?.price || item?.unit_price || 0),
        cost_price: Number(item?.cost_price || 0),
        unit: String(item?.unit || defaultUnitByType(productType)).trim(),
        description: String(item?.description || "").trim(),
        allow_topping: parseBooleanValue(item?.allow_topping),
        allow_size: parseBooleanValue(item?.allow_size) || options.length > 0,
        aliases: normalizeAliases(item?.aliases || item?.ai_aliases),
        source_text: String(item?.source_text || item?.source || "").trim(),
        needs_review: Boolean(item?.needs_review),
        review_reasons: Array.isArray(item?.review_reasons)
          ? item.review_reasons.map((reason) => String(reason || "").trim()).filter(Boolean)
          : [],
        ocr_corrected: Boolean(item?.ocr_corrected),
        direct_source_evidence: Boolean(item?.direct_source_evidence),
        vision_detected: Boolean(item?.vision_detected),
        inferred_price: Boolean(item?.inferred_price),
        price_source: String(item?.price_source || "").trim(),
        options,
      };
    })
    .filter((item) => item.name);
};

const parseOrder = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: "Text is required",
      });
    }

    const aiResult = await parseOrderByAI(text);

    const validatedResult = await prisma.$transaction(async (tx) => {
      const items = [];

      if (!Array.isArray(aiResult.items) || aiResult.items.length === 0) {
        throw new Error("AI did not detect any order item");
      }

      for (const item of aiResult.items) {
        const product = await findProductByNameOrAlias(tx, item.name);

        if (!product) {
          items.push({
            ai_name: item.name,
            matched: false,
            message: "Product not found",
            quantity: Number(item.quantity || 1),
            option: item.option || "",
            toppings: item.toppings || [],
            note: item.note || "",
          });

          continue;
        }

        const option = await findOptionByName(
          tx,
          product.id,
          item.option,
          item.name
        );
        const toppings = await findToppingsByNames(tx, item.toppings || []);

        const basePrice = Number(product.selling_price || 0);
        const optionExtraPrice = option ? Number(option.extra_price || 0) : 0;
        const toppingTotal = toppings.reduce((sum, topping) => {
          return sum + Number(topping.price || 0);
        }, 0);

        const quantity = Number(item.quantity || 1);
        const unitPrice = basePrice + optionExtraPrice + toppingTotal;
        const total = unitPrice * quantity;

        items.push({
          matched: true,
          product_id: product.id,
          product_code: product.code,
          product_name: product.name,
          ai_name: item.name,
          quantity,
          option_id: option ? option.id : null,
          option_name: option ? option.option_name : "",
          option_extra_price: optionExtraPrice,
          topping_ids: toppings.map((topping) => topping.id),
          toppings: toppings.map((topping) => ({
            id: topping.id,
            name: topping.name,
            price: Number(topping.price || 0),
          })),
          note: item.note || "",
          base_price: basePrice,
          unit_price: unitPrice,
          total,
          stock_quantity: product.stock_quantity,
          enough_stock: Number(product.stock_quantity) >= quantity,
        });
      }

      const totalAmount = items.reduce((sum, item) => {
        return sum + Number(item.total || 0);
      }, 0);

      return {
        customer_name: aiResult.customer_name || "",
        order_type: aiResult.order_type || "takeaway",
        payment_method: aiResult.payment_method || "cash",
        items,
        total_amount: totalAmount,
      };
    });

    await prisma.ai_order_logs.create({
      data: {
        user_id: req.user?.id ? Number(req.user.id) : null,
        input_text: text,
        ai_result: validatedResult,
        status: "success",
      },
    });

    return res.json({
      success: true,
      message: "Parse order successfully",
      data: validatedResult,
    });
  } catch (error) {
    console.error("AI parse order error:", error);

    try {
      await prisma.ai_order_logs.create({
        data: {
          user_id: req.user?.id ? Number(req.user.id) : null,
          input_text: req.body?.text || "",
          ai_result: {},
          status: "failed",
          error_message: error.message,
        },
      });
    } catch (logError) {
      console.error("Save AI log error:", logError);
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

const parseMenu = async (req, res) => {
  try {
    const { prompt } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "Menu file is required",
      });
    }

    let aiResult;
    let sourceText = "";
    let uploadType = "";

    if (supportedTextMimeTypes.has(file.mimetype)) {
      const text = file.buffer.toString("utf8").trim();

      if (!text) {
        return res.status(400).json({
          success: false,
          message: "Uploaded text file is empty",
        });
      }

      sourceText = text;
      uploadType = "text";
      const deterministicItems = parseMenuTextDeterministically({
        text,
        fileName: file.originalname,
      });

      aiResult = {
        items: deterministicItems,
      };
    } else if (supportedImageMimeTypes.has(file.mimetype)) {
      uploadType = "image";
      const imageBase64 = file.buffer.toString("base64");
      let aiVisionItems = [];

      if (process.env.OLLAMA_URL && process.env.OLLAMA_URL !== "undefined") {
        try {
          const aiImageResult = await parseMenuByAI({
            type: "image",
            imageBase64,
            mimeType: file.mimetype,
            fileName: file.originalname,
            prompt:
              "Doc truc tiep tu anh menu. Bo qua watermark, logo, so dien thoai, chu trang tri va hinh minh hoa. " +
              "Co nhieu template menu khac nhau nen can uu tien nhan dien ten mon va gia hien thi dang 20k, 25k, 18k, 15k. " +
              "Neu ten mon xuong 2 dong thi gop lai thanh 1 ten day du. Khong duoc tao mon moi ngoai anh.",
          });

          aiVisionItems = normalizeMenuItems(aiImageResult).map((item) => ({
            ...item,
            vision_detected: true,
          }));
        } catch (aiVisionError) {
          console.error("AI vision parse menu error:", aiVisionError.message);
        }
      }

      const extractedOcr = await extractMenuTextFromImageWithOllama({
        imageBase64,
        mimeType: file.mimetype,
        fileName: file.originalname,
      });

      if (extractedOcr?.text === "OCR_FAILED") {
        return res.status(422).json({
          success: false,
          message:
            "Khong the doc duoc noi dung menu tu anh nay. Vui long dung anh ro hon, thang hon, hoac upload file TXT/CSV/JSON.",
          data: {
            items: [],
            meta: {
              total_items: 0,
              accepted_items: 0,
              rejected_items: 0,
              grounding_mode: "source_text_match",
              parser_mode: "ocr_then_rules_only",
              extracted_text_preview: "OCR_FAILED",
            },
          },
        });
      }

      sourceText = extractedOcr?.text || "";
      const ocrNameCandidates = extractImageMenuNameCandidates(sourceText);
      const columnItems = Array.isArray(extractedOcr?.columns)
        ? extractedOcr.columns.flatMap((column) =>
            parseImageMenuItems({
              text: column?.text || "",
              textLines: Array.isArray(column?.lines) ? column.lines : [],
              fallbackPrices: Array.isArray(column?.prices) ? column.prices : [],
            })
          )
        : [];
      const deterministicItems =
        columnItems.length > 0
          ? dedupeMenuItems(columnItems)
          : parseImageMenuItems({
              text: sourceText,
              textLines: Array.isArray(extractedOcr?.lines) ? extractedOcr.lines : [],
              fallbackPrices: Array.isArray(extractedOcr?.globalPrices) ? extractedOcr.globalPrices : [],
            });

      let aiNormalizedItems = [];
      try {
        const aiTextResult = await parseMenuByAI({
          type: "text",
          text: sourceText,
          fileName: `${file.originalname}.ocr.txt`,
          prompt:
            "Chuan hoa lai ten mon tieng Viet tu OCR neu co the. Khong duoc them mon moi. " +
            "Chi giu mon co bang chung trong source_text. " +
            "Neu gia hien thi dang 10.000, 15.000, 5.000 thi tra ve dung theo VND. " +
            "Neu thay topping, sua chua, siro, nuoc ngot thi phan loai la drink.",
        });

        aiNormalizedItems = normalizeMenuItems(aiTextResult).filter(
          (item) =>
            Number(item?.selling_price || 0) >= 1000 &&
            hasDirectSourceEvidence(item, sourceText)
        );
      } catch (aiMenuError) {
        console.error("AI normalize menu text error:", aiMenuError.message);
      }

      const combinedDetectedItems = dedupeMenuItems([
        ...ocrNameCandidates,
        ...deterministicItems,
        ...aiNormalizedItems,
      ]);

      aiResult = {
        items: dedupeMenuItems(mergeAiHintsIntoDetectedItems(combinedDetectedItems, aiVisionItems)),
      };
    } else {
      return res.status(400).json({
        success: false,
        message:
          "Unsupported file type. Current backend supports TXT, CSV, JSON, PNG, JPG, JPEG, WEBP",
      });
    }

    const normalizedItems = normalizeMenuItems(aiResult).map((item) =>
      annotateMenuItem(item, {
        sourceText,
        uploadType,
      })
    );
    const groundedItems = normalizedItems.filter((item) => isMenuItemGrounded(item, sourceText));
    const items =
      uploadType === "image"
        ? groundedItems.filter(
            (item) =>
              isReasonableMenuItemName(item?.name) &&
              looksLikeCleanMenuName(item?.name) &&
              (item.direct_source_evidence || hasMeaningfulPriceInText(item?.source_text || ""))
          )
        : groundedItems;
    const rejectedItems = normalizedItems.length - items.length;
    const needsReviewItems = items.filter((item) => item.needs_review).length;

    return res.json({
      success: true,
      message: "Parse menu successfully",
      data: {
        items,
        meta: {
          total_items: normalizedItems.length,
          accepted_items: items.length,
          rejected_items: rejectedItems,
          needs_review_items: needsReviewItems,
          grounding_mode: "source_text_match",
          parser_mode: uploadType === "image" ? "ocr_then_rules_only" : "rules_only",
          extracted_text_preview: sourceText.slice(0, 500),
        },
      },
    });
  } catch (error) {
    console.error("AI parse menu error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

module.exports = {
  parseOrder,
  parseMenu,
};
