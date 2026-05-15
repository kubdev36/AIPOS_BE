const prisma = require("../config/prisma");

const getKitchenOrders = async (req, res) => {
  try {
    const { status } = req.query;

    const where = {
      status: {
        in: status ? [status] : ["pending", "preparing", "ready"],
      },
    };

    const orders = await prisma.orders.findMany({
      where,
      orderBy: {
        created_at: "asc",
      },
    });

    const orderIds = orders.map((order) => order.id);

    const orderItems = await prisma.order_items.findMany({
      where: {
        order_id: {
          in: orderIds,
        },
      },
      orderBy: {
        id: "asc",
      },
    });

    const itemIds = orderItems.map((item) => item.id);

    const toppings = await prisma.order_item_toppings.findMany({
      where: {
        order_item_id: {
          in: itemIds,
        },
      },
    });

    const data = orders.map((order) => {
      const items = orderItems
        .filter((item) => item.order_id === order.id)
        .map((item) => ({
          ...item,
          toppings: toppings.filter(
            (topping) => topping.order_item_id === item.id
          ),
        }));

      return {
        ...order,
        items,
      };
    });

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get kitchen orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateKitchenOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["pending", "preparing", "ready", "completed"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid kitchen status",
      });
    }

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

    if (order.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Cannot update cancelled order",
      });
    }

    const updatedOrder = await prisma.orders.update({
      where: {
        id: Number(id),
      },
      data: {
        status,
      },
    });

    return res.json({
      success: true,
      message: "Update kitchen order status successfully",
      data: updatedOrder,
    });
  } catch (error) {
    console.error("Update kitchen order status error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getKitchenOrders,
  updateKitchenOrderStatus,
};