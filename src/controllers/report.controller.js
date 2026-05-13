const prisma = require("../config/prisma");

const getOverviewReport = async (req, res) => {
  try {
    const now = new Date();

    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0
    );

    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59
    );

    const todayOrders = await prisma.orders.findMany({
      where: {
        status: "completed",
        created_at: {
          gte: startOfToday,
          lte: endOfToday,
        },
      },
    });

    const todayRevenue = todayOrders.reduce((sum, order) => {
      return sum + Number(order.final_amount || 0);
    }, 0);

    const todayOrderCount = todayOrders.length;

    const totalProducts = await prisma.products.count({
      where: {
        status: true,
      },
    });

    const totalCustomers = await prisma.customers.count({
      where: {
        status: true,
      },
    });

    const lowStockProducts = await prisma.products.findMany({
      where: {
        status: true,
      },
      orderBy: {
        stock_quantity: "asc",
      },
      take: 10,
    });

    const filteredLowStockProducts = lowStockProducts.filter((product) => {
      return Number(product.stock_quantity) <= Number(product.min_stock);
    });

    return res.json({
      success: true,
      data: {
        today_revenue: todayRevenue,
        today_order_count: todayOrderCount,
        total_products: totalProducts,
        total_customers: totalCustomers,
        low_stock_products: filteredLowStockProducts,
      },
    });
  } catch (error) {
    console.error("Overview report error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getRevenueLast7Days = async (req, res) => {
  try {
    const result = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);

      const startOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        0,
        0,
        0
      );

      const endOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        23,
        59,
        59
      );

      const orders = await prisma.orders.findMany({
        where: {
          status: "completed",
          created_at: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });

      const revenue = orders.reduce((sum, order) => {
        return sum + Number(order.final_amount || 0);
      }, 0);

      result.push({
        date: startOfDay.toISOString().slice(0, 10),
        revenue,
        order_count: orders.length,
      });
    }

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Revenue last 7 days error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getTopProducts = async (req, res) => {
  try {
    const limit = Number(req.query.limit || 5);

    const groupedItems = await prisma.order_items.groupBy({
      by: ["product_id", "product_name"],
      _sum: {
        quantity: true,
        total: true,
      },
      orderBy: {
        _sum: {
          quantity: "desc",
        },
      },
      take: limit,
    });

    const data = groupedItems.map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      total_sold: item._sum.quantity || 0,
      total_revenue: Number(item._sum.total || 0),
    }));

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Top products error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getLowStockProducts = async (req, res) => {
  try {
    const products = await prisma.products.findMany({
      where: {
        status: true,
      },
      orderBy: {
        stock_quantity: "asc",
      },
    });

    const lowStockProducts = products.filter((product) => {
      return Number(product.stock_quantity) <= Number(product.min_stock);
    });

    return res.json({
      success: true,
      data: lowStockProducts,
    });
  } catch (error) {
    console.error("Low stock products error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getRevenueByDateRange = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;

    if (!from_date || !to_date) {
      return res.status(400).json({
        success: false,
        message: "from_date and to_date are required",
      });
    }

    const startDate = new Date(from_date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(to_date);
    endDate.setHours(23, 59, 59, 999);

    const orders = await prisma.orders.findMany({
      where: {
        status: "completed",
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        created_at: "asc",
      },
    });

    const totalRevenue = orders.reduce((sum, order) => {
      return sum + Number(order.final_amount || 0);
    }, 0);

    const totalPaid = orders.reduce((sum, order) => {
      return sum + Number(order.paid_amount || 0);
    }, 0);

    const totalDebt = orders.reduce((sum, order) => {
      return sum + Number(order.debt_amount || 0);
    }, 0);

    return res.json({
      success: true,
      data: {
        from_date,
        to_date,
        total_revenue: totalRevenue,
        total_paid: totalPaid,
        total_debt: totalDebt,
        order_count: orders.length,
        orders,
      },
    });
  } catch (error) {
    console.error("Revenue by date range error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getOverviewReport,
  getRevenueLast7Days,
  getTopProducts,
  getLowStockProducts,
  getRevenueByDateRange,
};