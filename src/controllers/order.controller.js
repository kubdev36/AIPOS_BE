const prisma = require("../config/prisma");

const generateOrderCode = () => {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  const time = String(now.getTime()).slice(-6);

  return `HD${year}${month}${date}${time}`;
};

const createOrder = async (req, res) => {
  try {
    const {
      customer_id,
      table_id,
      branch_id,
      order_type,
      discount,
      payment_method,
      paid_amount,
      note,
      items,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order must have at least one item",
      });
    }

    const userId = req.user.id;
    const userBranchId = req.user.branch_id || branch_id || 1;

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
          throw new Error(`Product not found: ${productId}`);
        }

        if (product.stock_quantity < quantity) {
          throw new Error(`Product ${product.name} is out of stock`);
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
            throw new Error(`Invalid option for product ${product.name}`);
          }

          optionExtraPrice = Number(option.extra_price || 0);
        }

        let toppings = [];
        let toppingTotal = 0;

        if (toppingIds.length > 0) {
          toppings = await tx.toppings.findMany({
            where: {
              id: {
                in: toppingIds,
              },
              status: true,
            },
          });

          if (toppings.length !== toppingIds.length) {
            throw new Error("One or more toppings are invalid");
          }

          toppingTotal = toppings.reduce((sum, topping) => {
            return sum + Number(topping.price || 0);
          }, 0);
        }

        const basePrice = Number(product.selling_price || 0);
        const itemPrice = basePrice + optionExtraPrice + toppingTotal;
        const itemTotal = itemPrice * quantity;

        totalAmount += itemTotal;

        orderItemsData.push({
          product,
          quantity,
          option,
          optionExtraPrice,
          toppings,
          sellingPrice: itemPrice,
          total: itemTotal,
          note: item.note || null,
        });
      }

      const discountValue = Number(discount || 0);

      if (discountValue < 0) {
        throw new Error("Discount cannot be negative");
      }

      if (discountValue > totalAmount) {
        throw new Error("Discount cannot be greater than total amount");
      }

      const finalAmount = totalAmount - discountValue;
      const paidAmountValue =
        paid_amount !== undefined ? Number(paid_amount) : finalAmount;
      const debtAmount = Math.max(finalAmount - paidAmountValue, 0);

      let paymentStatus = "paid";

      if (paidAmountValue <= 0) {
        paymentStatus = "unpaid";
      } else if (paidAmountValue < finalAmount) {
        paymentStatus = "partial";
      }

      const order = await tx.orders.create({
        data: {
          order_code: generateOrderCode(),
          customer_id: customer_id ? Number(customer_id) : null,
          user_id: Number(userId),
          branch_id: Number(userBranchId),
          table_id: table_id ? Number(table_id) : null,
          order_type: order_type || "takeaway",
          total_amount: totalAmount,
          discount: discountValue,
          final_amount: finalAmount,
          paid_amount: paidAmountValue,
          debt_amount: debtAmount,
          payment_method: payment_method || "cash",
          payment_status: paymentStatus,
          status: "pending",
          note: note || null,
        },
      });

      for (const item of orderItemsData) {
        const beforeQuantity = item.product.stock_quantity;
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
            selling_price: item.sellingPrice,
            total: item.total,
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
            user_id: Number(userId),
            branch_id: Number(userBranchId),
            type: "sale",
            quantity: item.quantity,
            before_quantity: beforeQuantity,
            after_quantity: afterQuantity,
            reference_type: "order",
            reference_id: order.id,
            note: `Bán hàng - ${order.order_code}`,
          },
        });
      }

      if (customer_id) {
        await tx.customers.update({
          where: {
            id: Number(customer_id),
          },
          data: {
            total_spent: {
              increment: finalAmount,
            },
            debt: {
              increment: debtAmount,
            },
          },
        });
      }

      if (table_id && order_type === "dine_in") {
        await tx.dining_tables.update({
          where: {
            id: Number(table_id),
          },
          data: {
            status: "occupied",
          },
        });
      }

      return order;
    });

    return res.status(201).json({
      success: true,
      message: "Create order successfully",
      data: result,
    });
  } catch (error) {
    console.error("Create order error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

const getOrders = async (req, res) => {
  try {
    const { status, order_type, from_date, to_date } = req.query;

    const where = {};

    if (status) {
      where.status = status;
    }

    if (order_type) {
      where.order_type = order_type;
    }

    if (from_date || to_date) {
      where.created_at = {};

      if (from_date) {
        where.created_at.gte = new Date(from_date);
      }

      if (to_date) {
        const endDate = new Date(to_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    const orders = await prisma.orders.findMany({
      where,
      orderBy: {
        id: "desc",
      },
    });

    return res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    console.error("Get orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.orders.findUnique({
      where: {
        id: Number(id),
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const orderItems = await prisma.order_items.findMany({
      where: {
        order_id: Number(id),
      },
      orderBy: {
        id: "asc",
      },
    });

    const orderItemIds = orderItems.map((item) => item.id);

    const orderItemToppings = await prisma.order_item_toppings.findMany({
      where: {
        order_item_id: {
          in: orderItemIds,
        },
      },
      orderBy: {
        id: "asc",
      },
    });

    const itemsWithToppings = orderItems.map((item) => {
      return {
        ...item,
        toppings: orderItemToppings.filter(
          (topping) => topping.order_item_id === item.id
        ),
      };
    });

    return res.json({
      success: true,
      data: {
        ...order,
        items: itemsWithToppings,
      },
    });
  } catch (error) {
    console.error("Get order by id error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.orders.findUnique({
        where: {
          id: Number(id),
        },
      });

      if (!order) {
        throw new Error("Order not found");
      }

      if (order.status === "cancelled") {
        throw new Error("Order already cancelled");
      }

      const orderItems = await tx.order_items.findMany({
        where: {
          order_id: Number(id),
        },
      });

      for (const item of orderItems) {
        if (!item.product_id) continue;

        const product = await tx.products.findUnique({
          where: {
            id: item.product_id,
          },
        });

        if (!product) continue;

        const beforeQuantity = product.stock_quantity;
        const afterQuantity = beforeQuantity + item.quantity;

        await tx.products.update({
          where: {
            id: product.id,
          },
          data: {
            stock_quantity: afterQuantity,
          },
        });

        await tx.inventory_logs.create({
          data: {
            product_id: product.id,
            user_id: Number(req.user.id),
            branch_id: order.branch_id,
            type: "cancel_order",
            quantity: item.quantity,
            before_quantity: beforeQuantity,
            after_quantity: afterQuantity,
            reference_type: "order",
            reference_id: order.id,
            note: `Hủy đơn - ${order.order_code}`,
          },
        });
      }

      const updatedOrder = await tx.orders.update({
        where: {
          id: Number(id),
        },
        data: {
          status: "cancelled",
        },
      });

      if (order.customer_id) {
        await tx.customers.update({
          where: {
            id: order.customer_id,
          },
          data: {
            total_spent: {
              decrement: Number(order.final_amount || 0),
            },
            debt: {
              decrement: Number(order.debt_amount || 0),
            },
          },
        });
      }

      return updatedOrder;
    });

    return res.json({
      success: true,
      message: "Cancel order successfully",
      data: result,
    });
  } catch (error) {
    console.error("Cancel order error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  cancelOrder,
};