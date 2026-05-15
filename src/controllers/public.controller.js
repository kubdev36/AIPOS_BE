const prisma = require("../config/prisma");
const { parseOrderByAI } = require("../services/ai.service");

const getPublicMenu = async (req, res) => {
  try {
    const products = await prisma.products.findMany({
      where: {
        status: true,
      },
      include: {
        categories: true,
        product_options: {
          where: {
            status: true,
          },
        },
        product_aliases: true,
      },
      orderBy: {
        id: "desc",
      },
    });

    const toppings = await prisma.toppings.findMany({
      where: {
        status: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    const categories = await prisma.categories.findMany({
      where: {
        status: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    return res.json({
      success: true,
      data: {
        categories,
        products,
        toppings,
      },
    });
  } catch (error) {
    console.error("Get public menu error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getPublicTable = async (req, res) => {
  try {
    const { id } = req.params;

    const table = await prisma.dining_tables.findUnique({
      where: {
        id: Number(id),
      },
    });

    if (!table || table.status === "inactive") {
      return res.status(404).json({
        success: false,
        message: "Table not found",
      });
    }

    return res.json({
      success: true,
      data: table,
    });
  } catch (error) {
    console.error("Get public table error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const createPublicOrder = async (req, res) => {
  try {
    const { table_id, customer_name, customer_phone, note, items } = req.body;

    if (!table_id) {
      return res.status(400).json({
        success: false,
        message: "Table ID is required",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order must have at least one item",
      });
    }

    const table = await prisma.dining_tables.findUnique({
      where: {
        id: Number(table_id),
      },
    });

    if (!table || table.status === "inactive") {
      return res.status(404).json({
        success: false,
        message: "Table not found",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const orderItemsData = [];

      for (const item of items) {
        const productId = Number(item.product_id);
        const quantity = Number(item.quantity || 0);
        const optionId = item.option_id ? Number(item.option_id) : null;
        const toppingIds = Array.isArray(item.topping_ids)
          ? item.topping_ids.map((id) => Number(id))
          : [];

        if (!productId || quantity <= 0) {
          throw new Error("Invalid product or quantity");
        }

        const product = await tx.products.findUnique({
          where: {
            id: productId,
          },
        });

        if (!product || !product.status) {
          throw new Error("Product not found");
        }

        if (Number(product.stock_quantity) < quantity) {
          throw new Error(`${product.name} không đủ tồn kho`);
        }

        let option = null;
        let optionExtraPrice = 0;

        if (optionId) {
          option = await tx.product_options.findUnique({
            where: {
              id: optionId,
            },
          });

          if (!option || option.product_id !== product.id || !option.status) {
            throw new Error(`Invalid option for ${product.name}`);
          }

          optionExtraPrice = Number(option.extra_price || 0);
        }

        const toppings = await tx.toppings.findMany({
          where: {
            id: {
              in: toppingIds,
            },
            status: true,
          },
        });

        if (toppings.length !== toppingIds.length) {
          throw new Error("Invalid topping");
        }

        const toppingTotal = toppings.reduce((sum, topping) => {
          return sum + Number(topping.price || 0);
        }, 0);

        const unitPrice =
          Number(product.selling_price || 0) + optionExtraPrice + toppingTotal;

        const itemTotal = unitPrice * quantity;

        totalAmount += itemTotal;

        orderItemsData.push({
          product,
          quantity,
          option,
          optionExtraPrice,
          toppings,
          unitPrice,
          itemTotal,
          note: item.note || null,
        });
      }

      const orderCode = `QR${Date.now()}`;

      const order = await tx.orders.create({
        data: {
          order_code: orderCode,
          customer_id: null,
          user_id: null,
          branch_id: table.branch_id || 1,
          table_id: Number(table_id),
          order_type: "dine_in",
          total_amount: totalAmount,
          discount: 0,
          final_amount: totalAmount,
          paid_amount: 0,
          debt_amount: totalAmount,
          payment_method: "cash",
          payment_status: "unpaid",
          status: "pending",
          note: `QR Order${customer_name ? ` - Khách: ${customer_name}` : ""}${
            customer_phone ? ` - SĐT: ${customer_phone}` : ""
          }${note ? ` - Ghi chú: ${note}` : ""}`,
        },
      });

      for (const item of orderItemsData) {
        const beforeQuantity = Number(item.product.stock_quantity || 0);
        const afterQuantity = beforeQuantity - item.quantity;

        const orderItem = await tx.order_items.create({
          data: {
            order_id: order.id,
            product_id: item.product.id,
            option_id: item.option ? item.option.id : null,
            product_name: item.product.name,
            product_code: item.product.code,
            option_name: item.option ? item.option.option_name : null,
            option_extra_price: item.optionExtraPrice,
            quantity: item.quantity,
            cost_price: Number(item.product.cost_price || 0),
            selling_price: item.unitPrice,
            total: item.itemTotal,
            note: item.note,
          },
        });

        if (item.toppings.length > 0) {
          await tx.order_item_toppings.createMany({
            data: item.toppings.map((topping) => ({
              order_item_id: orderItem.id,
              topping_id: topping.id,
              topping_name: topping.name,
              price: Number(topping.price || 0),
            })),
          });
        }

        await tx.products.update({
          where: {
            id: item.product.id,
          },
          data: {
            stock_quantity: afterQuantity,
          },
        });

        await tx.inventory_logs.create({
          data: {
            product_id: item.product.id,
            user_id: null,
            branch_id: table.branch_id || 1,
            type: "sale",
            quantity: item.quantity,
            before_quantity: beforeQuantity,
            after_quantity: afterQuantity,
            reference_type: "qr_order",
            reference_id: order.id,
            note: `QR Order - ${order.order_code}`,
          },
        });
      }

      await tx.dining_tables.update({
        where: {
          id: Number(table_id),
        },
        data: {
          status: "occupied",
        },
      });

      return order;
    });

    return res.status(201).json({
      success: true,
      message: "QR order created successfully",
      data: result,
    });
  } catch (error) {
    console.error("Create public order error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

const normalizeText = (value) => {
  return String(value || "").trim().toLowerCase();
};

const cleanProductName = (name) => {
  return normalizeText(name)
    .replace(/size\s*(s|m|l|xl)/gi, "")
    .replace(/\b(s|m|l|xl)\b/gi, "")
    .replace(/thêm.*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
};

const findProductByNameOrAlias = async (tx, name) => {
  const searchName = cleanProductName(name);

  if (!searchName) return null;

  const product = await tx.products.findFirst({
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

  if (!alias) return null;

  return tx.products.findFirst({
    where: {
      id: alias.product_id,
      status: true,
    },
  });
};

const extractSizeFromText = (text) => {
  const value = normalizeText(text);

  if (value.includes("size xl") || value.endsWith(" xl")) return "Size XL";
  if (value.includes("size l") || value.endsWith(" l")) return "Size L";
  if (value.includes("size m") || value.endsWith(" m")) return "Size M";
  if (value.includes("size s") || value.endsWith(" s")) return "Size S";

  return "";
};

const findOptionByName = async (tx, productId, optionName, productText = "") => {
  let searchOption = normalizeText(optionName);

  if (!searchOption) {
    searchOption = normalizeText(extractSizeFromText(productText));
  }

  if (!searchOption) return null;

  return tx.product_options.findFirst({
    where: {
      product_id: productId,
      status: true,
      option_name: {
        equals: searchOption,
        mode: "insensitive",
      },
    },
  });
};

const findToppingsByNames = async (tx, toppingNames = []) => {
  const results = [];

  for (const toppingName of toppingNames) {
    const topping = await tx.toppings.findFirst({
      where: {
        status: true,
        name: {
          equals: normalizeText(toppingName),
          mode: "insensitive",
        },
      },
    });

    if (topping) results.push(topping);
  }

  return results;
};

const parsePublicAIOrder = async (req, res) => {
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
            matched: false,
            ai_name: item.name,
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

        const toppingTotal = toppings.reduce((sum, topping) => {
          return sum + Number(topping.price || 0);
        }, 0);

        const optionExtraPrice = option ? Number(option.extra_price || 0) : 0;
        const basePrice = Number(product.selling_price || 0);
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
        order_type: "dine_in",
        payment_method: "cash",
        items,
        total_amount: totalAmount,
      };
    });

    return res.json({
      success: true,
      message: "Parse QR AI order successfully",
      data: validatedResult,
    });
  } catch (error) {
    console.error("Parse public AI order error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

module.exports = {
  getPublicMenu,
  getPublicTable,
  createPublicOrder,
  parsePublicAIOrder,
};