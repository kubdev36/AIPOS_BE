const prisma = require("../config/prisma");

const PRODUCT_CODE_PREFIXES = {
  drink: "DR",
  food: "FD",
  combo: "CB",
};

const normalizeText = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const CATEGORY_SYNONYM_GROUPS = [
  ["ca phe", ["ca phe", "cafe", "coffee"]],
  ["tra sua", ["tra sua", "milk tea"]],
  ["tra", ["tra", "tea", "hong tra"]],
  ["nuoc ep", ["nuoc ep", "juice"]],
  ["sinh to", ["sinh to", "smoothie", "da xay", "ice blended"]],
  ["sua chua", ["sua chua", "yogurt", "yaourt"]],
  ["giai khat", ["giai khat", "nuoc ngot", "soft drink"]],
  ["topping", ["topping", "topping them", "add on", "add-on"]],
  ["combo", ["combo", "set"]],
  ["mon an", ["mon an", "do an", "thuc an", "food"]],
  ["an vat", ["an vat", "snack"]],
];

const detectCategoryType = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) return "";
  if (/(combo|set)/.test(normalized)) return "combo";
  if (/(mon an|do an|thuc an|food|an vat|com|pho|bun|mi|chao|sup|lau|nuong)/.test(normalized)) {
    return "food";
  }
  if (
    /(ca phe|cafe|coffee|tra|tea|nuoc|sinh to|smoothie|sua chua|yogurt|giai khat|topping|juice)/.test(
      normalized
    )
  ) {
    return "drink";
  }

  return "";
};

const buildCategorySearchTerms = ({ categoryName = "", productType = "", productName = "" }) => {
  const combinedText = normalizeText([categoryName, productName].filter(Boolean).join(" "));
  const terms = new Set();

  if (categoryName) {
    terms.add(normalizeText(categoryName));
  }

  for (const [canonical, synonyms] of CATEGORY_SYNONYM_GROUPS) {
    if (synonyms.some((synonym) => combinedText.includes(normalizeText(synonym)))) {
      terms.add(canonical);
      synonyms.forEach((synonym) => terms.add(normalizeText(synonym)));
    }
  }

  if (productType === "food") {
    terms.add("mon an");
    terms.add("do an");
  }

  if (productType === "drink") {
    terms.add("do uong");
    terms.add("giai khat");
  }

  if (productType === "combo") {
    terms.add("combo");
  }

  return Array.from(terms).filter(Boolean);
};

const scoreCategoryMatch = (category, { categoryName = "", productType = "", productName = "" }) => {
  const normalizedCategoryName = normalizeText(category?.name);
  const searchTerms = buildCategorySearchTerms({ categoryName, productType, productName });

  if (!normalizedCategoryName || searchTerms.length === 0) {
    return -1;
  }

  let score = -1;

  for (const term of searchTerms) {
    if (!term) continue;

    if (normalizedCategoryName === term) {
      score = Math.max(score, 100);
      continue;
    }

    if (normalizedCategoryName.includes(term) || term.includes(normalizedCategoryName)) {
      score = Math.max(score, 82);
    }

    const categoryTokens = normalizedCategoryName.split(" ").filter(Boolean);
    const termTokens = term.split(" ").filter(Boolean);
    const matchedTokens = termTokens.filter((token) => categoryTokens.includes(token)).length;

    if (matchedTokens > 0) {
      const overlapScore = Math.round((matchedTokens / Math.max(termTokens.length, categoryTokens.length)) * 70);
      score = Math.max(score, overlapScore);
    }
  }

  const categoryType = detectCategoryType(category?.name);
  if (productType && categoryType === productType) {
    score += 8;
  }

  return score;
};

const resolveCategoryId = async (tx, { categoryId, categoryName, productType, productName }) => {
  if (categoryId) {
    return Number(categoryId);
  }

  const normalizedCategoryName = normalizeText(categoryName);
  if (!normalizedCategoryName && !productType) {
    return null;
  }

  const categories = await tx.categories.findMany({
    where: {
      status: true,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (categories.length === 0) {
    return null;
  }

  const rankedCategories = categories
    .map((category) => ({
      ...category,
      score: scoreCategoryMatch(category, {
        categoryName,
        productType,
        productName,
      }),
    }))
    .filter((category) => category.score >= 0)
    .sort((left, right) => right.score - left.score);

  if (rankedCategories.length === 0) {
    return null;
  }

  const [bestMatch, secondMatch] = rankedCategories;
  const scoreGap = bestMatch.score - (secondMatch?.score ?? -1);

  if (bestMatch.score >= 100) {
    return bestMatch.id;
  }

  if (bestMatch.score >= 82 && scoreGap >= 5) {
    return bestMatch.id;
  }

  if (bestMatch.score >= 68 && scoreGap >= 12) {
    return bestMatch.id;
  }

  return null;
};

const generateProductCode = async (tx, productType = "drink") => {
  const normalizedType = PRODUCT_CODE_PREFIXES[productType] ? productType : "drink";
  const prefix = PRODUCT_CODE_PREFIXES[normalizedType];

  const existingProducts = await tx.products.findMany({
    where: {
      code: {
        startsWith: prefix,
      },
    },
    select: {
      code: true,
    },
  });

  const nextNumber =
    existingProducts.reduce((maxValue, product) => {
      const match = product.code.match(new RegExp(`^${prefix}(\\d+)$`, "i"));

      if (!match) {
        return maxValue;
      }

      return Math.max(maxValue, Number(match[1]));
    }, 0) + 1;

  return `${prefix}${String(nextNumber).padStart(3, "0")}`;
};

const getProducts = async (req, res) => {
  try {
    const { search, category_id, product_type } = req.query;

    const products = await prisma.products.findMany({
      where: {
        status: true,
        ...(search && {
          OR: [
            {
              name: {
                contains: search,
                mode: "insensitive",
              },
            },
            {
              code: {
                contains: search,
                mode: "insensitive",
              },
            },
          ],
        }),
        ...(category_id && {
          category_id: Number(category_id),
        }),
        ...(product_type && {
          product_type,
        }),
      },
      include: {
        categories: true,
        product_options: true,
        product_aliases: true,
      },
      orderBy: {
        id: "desc",
      },
    });

    return res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("Get products error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.products.findUnique({
      where: {
        id: Number(id),
      },
      include: {
        categories: true,
        product_options: true,
        product_aliases: true,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Get product by id error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const createProduct = async (req, res) => {
  try {
    const {
      category_id,
      category_name,
      code,
      name,
      image,
      product_type,
      unit,
      cost_price,
      selling_price,
      stock_quantity,
      min_stock,
      allow_topping,
      allow_size,
      description,
      aliases,
      options,
    } = req.body;

    if (!name || selling_price === undefined) {
      return res.status(400).json({
        success: false,
        message: "Name and selling price are required",
      });
    }

    const product = await prisma.$transaction(async (tx) => {
      const generatedCode = code?.trim() || (await generateProductCode(tx, product_type));
      const resolvedCategoryId = await resolveCategoryId(tx, {
        categoryId: category_id,
        categoryName: category_name,
        productType: product_type || "drink",
        productName: name,
      });

      const newProduct = await tx.products.create({
        data: {
          category_id: resolvedCategoryId,
          code: generatedCode,
          name,
          image: image || null,
          product_type: product_type || "drink",
          unit: unit || "ly",
          cost_price: Number(cost_price || 0),
          selling_price: Number(selling_price),
          stock_quantity: Number(stock_quantity || 0),
          min_stock: Number(min_stock || 5),
          allow_topping: Boolean(allow_topping),
          allow_size: Boolean(allow_size),
          description: description || null,
        },
      });

      if (Array.isArray(aliases) && aliases.length > 0) {
        await tx.product_aliases.createMany({
          data: aliases
            .filter((alias) => alias && alias.trim())
            .map((alias) => ({
              product_id: newProduct.id,
              alias_name: alias.trim(),
            })),
        });
      }

      if (Array.isArray(options) && options.length > 0) {
        await tx.product_options.createMany({
          data: options
            .filter((option) => option.option_name)
            .map((option) => ({
              product_id: newProduct.id,
              option_name: option.option_name,
              extra_price: Number(option.extra_price || 0),
            })),
        });
      }

      return newProduct;
    });

    return res.status(201).json({
      success: true,
      message: "Create product successfully",
      data: product,
    });
  } catch (error) {
    console.error("Create product error:", error);

    if (error.code === "P2002") {
      return res.status(400).json({
        success: false,
        message: "Product code already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      category_id,
      code,
      name,
      image,
      product_type,
      unit,
      cost_price,
      selling_price,
      stock_quantity,
      min_stock,
      allow_topping,
      allow_size,
      description,
      status,
    } = req.body;

    const product = await prisma.products.update({
      where: {
        id: Number(id),
      },
      data: {
        ...(category_id !== undefined && {
          category_id: category_id ? Number(category_id) : null,
        }),
        ...(code !== undefined && { code }),
        ...(name !== undefined && { name }),
        ...(image !== undefined && { image }),
        ...(product_type !== undefined && { product_type }),
        ...(unit !== undefined && { unit }),
        ...(cost_price !== undefined && { cost_price: Number(cost_price) }),
        ...(selling_price !== undefined && {
          selling_price: Number(selling_price),
        }),
        ...(stock_quantity !== undefined && {
          stock_quantity: Number(stock_quantity),
        }),
        ...(min_stock !== undefined && { min_stock: Number(min_stock) }),
        ...(allow_topping !== undefined && {
          allow_topping: Boolean(allow_topping),
        }),
        ...(allow_size !== undefined && {
          allow_size: Boolean(allow_size),
        }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status: Boolean(status) }),
      },
    });

    return res.json({
      success: true,
      message: "Update product successfully",
      data: product,
    });
  } catch (error) {
    console.error("Update product error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (error.code === "P2002") {
      return res.status(400).json({
        success: false,
        message: "Product code already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.products.update({
      where: {
        id: Number(id),
      },
      data: {
        status: false,
      },
    });

    return res.json({
      success: true,
      message: "Delete product successfully",
    });
  } catch (error) {
    console.error("Delete product error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
