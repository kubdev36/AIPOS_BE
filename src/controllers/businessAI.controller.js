const prisma = require("../config/prisma");
const { askBusinessWithOllama } = require("../services/ai.service");

const INTENT_KEYWORDS = {
  today_overview: [
    "hom nay",
    "ngay nay",
    "trong ngay",
    "doanh thu hom nay",
    "tong quan hom nay",
    "ban duoc bao nhieu",
    "so don hom nay",
  ],
  revenue_summary: [
    "doanh thu",
    "tong thu",
    "thu duoc",
    "ban duoc",
    "bao nhieu tien",
    "doanh so",
  ],
  top_products: [
    "ban chay",
    "top mon",
    "mon nao ban",
    "mon nao chay",
    "san pham ban chay",
    "best seller",
  ],
  low_stock: [
    "sap het",
    "ton kho thap",
    "het hang",
    "sap het hang",
    "can nhap",
    "thieu hang",
    "ton kho",
  ],
  unpaid_orders: [
    "chua thanh toan",
    "con no",
    "cong no",
    "no bao nhieu",
    "khach no",
    "don no",
  ],
  qr_orders: [
    "qr",
    "goi mon tai ban",
    "don qr",
    "don ban",
    "tai ban",
  ],
  kitchen_status: [
    "kitchen",
    "bep",
    "dang lam",
    "cho lam",
    "mon dang chuan bi",
    "trang thai bep",
    "don dang lam",
  ],
  payment_analysis: [
    "thanh toan bang gi",
    "phuong thuc thanh toan",
    "tien mat",
    "chuyen khoan",
    "momo",
    "vnpay",
    "the",
    "card",
    "cash",
    "banking",
  ],
  order_type_analysis: [
    "loai don",
    "takeaway",
    "delivery",
    "dine in",
    "an tai quan",
    "mang ve",
    "giao hang",
  ],
  cancelled_orders: [
    "don huy",
    "huy don",
    "bi huy",
    "cancelled",
    "cancel",
  ],
  customer_summary: [
    "khach hang",
    "khach nao",
    "khach than thiet",
    "top khach",
    "khach chi nhieu",
    "khach no",
  ],
};

const normalizeText = (value = "") => {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const includesAny = (text, keywords = []) => {
  return keywords.some((keyword) => text.includes(keyword));
};

const getStartAndEndOfDay = (dateInput = new Date()) => {
  const date = new Date(dateInput);
  const start = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  );
  const end = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  );

  return { start, end };
};

const getDateRangeByQuestion = (question) => {
  const text = normalizeText(question);
  const now = new Date();

  if (includesAny(text, ["hom qua", "ngay hom qua", "yesterday"])) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      key: "yesterday",
      label: "yesterday",
      ...getStartAndEndOfDay(yesterday),
    };
  }

  if (includesAny(text, ["7 ngay", "7 ngay qua", "1 tuan", "tuan nay", "gan day"])) {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return {
      key: "last_7_days",
      label: "last_7_days",
      start,
      end: now,
    };
  }

  if (includesAny(text, ["30 ngay", "1 thang qua", "thang qua"])) {
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return {
      key: "last_30_days",
      label: "last_30_days",
      start,
      end: now,
    };
  }

  if (includesAny(text, ["thang nay", "trong thang"])) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    return {
      key: "this_month",
      label: "this_month",
      start,
      end,
    };
  }

  return {
    key: "today",
    label: "today",
    ...getStartAndEndOfDay(now),
  };
};

const detectIntent = (question) => {
  const text = normalizeText(question);

  if (includesAny(text, INTENT_KEYWORDS.top_products)) return "top_products";
  if (includesAny(text, INTENT_KEYWORDS.low_stock)) return "low_stock";
  if (includesAny(text, INTENT_KEYWORDS.unpaid_orders)) return "unpaid_orders";
  if (includesAny(text, INTENT_KEYWORDS.qr_orders)) return "qr_orders";
  if (includesAny(text, INTENT_KEYWORDS.kitchen_status)) return "kitchen_status";
  if (includesAny(text, INTENT_KEYWORDS.payment_analysis)) return "payment_analysis";
  if (includesAny(text, INTENT_KEYWORDS.order_type_analysis)) return "order_type_analysis";
  if (includesAny(text, INTENT_KEYWORDS.cancelled_orders)) return "cancelled_orders";
  if (includesAny(text, INTENT_KEYWORDS.customer_summary)) return "customer_summary";
  if (includesAny(text, INTENT_KEYWORDS.today_overview)) return "today_overview";
  if (includesAny(text, INTENT_KEYWORDS.revenue_summary)) return "revenue_summary";

  return "general";
};

const sumAmount = (items = [], field) => {
  return items.reduce((sum, item) => sum + Number(item?.[field] || 0), 0);
};

const groupCount = (items = [], field) => {
  return items.reduce((accumulator, item) => {
    const key = item?.[field] || "unknown";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
};

const groupAmount = (items = [], field, amountField) => {
  return items.reduce((accumulator, item) => {
    const key = item?.[field] || "unknown";
    accumulator[key] = (accumulator[key] || 0) + Number(item?.[amountField] || 0);
    return accumulator;
  }, {});
};

const formatBreakdown = (valueMap = {}) => {
  return Object.entries(valueMap)
    .map(([key, value]) => ({
      key,
      value,
    }))
    .sort((a, b) => b.value - a.value);
};

const getOrdersInRange = async ({ start, end }, extraWhere = {}) => {
  return prisma.orders.findMany({
    where: {
      created_at: {
        gte: start,
        lte: end,
      },
      ...extraWhere,
    },
    orderBy: {
      created_at: "desc",
    },
  });
};

const getTodayOverviewData = async (range) => {
  const orders = await getOrdersInRange(range);
  const completedOrders = orders.filter((order) => order.status === "completed");

  return {
    type: "today_overview",
    period: range.label,
    total_orders: orders.length,
    completed_orders: completedOrders.length,
    pending_orders: orders.filter((order) => order.status === "pending").length,
    preparing_orders: orders.filter((order) => order.status === "preparing").length,
    ready_orders: orders.filter((order) => order.status === "ready").length,
    cancelled_orders: orders.filter((order) => order.status === "cancelled").length,
    today_revenue: sumAmount(completedOrders, "final_amount"),
    paid_amount: sumAmount(orders, "paid_amount"),
    debt_amount: sumAmount(orders, "debt_amount"),
  };
};

const getRevenueSummaryData = async (range) => {
  const orders = await getOrdersInRange(range, {
    status: {
      not: "cancelled",
    },
  });

  const revenue = sumAmount(orders, "final_amount");
  const paidAmount = sumAmount(orders, "paid_amount");
  const debtAmount = sumAmount(orders, "debt_amount");

  return {
    type: "revenue_summary",
    period: range.label,
    total_orders: orders.length,
    total_revenue: revenue,
    total_paid: paidAmount,
    total_debt: debtAmount,
    average_order_value: orders.length ? revenue / orders.length : 0,
    payment_method_breakdown: formatBreakdown(
      groupAmount(orders, "payment_method", "final_amount")
    ),
    status_breakdown: formatBreakdown(groupCount(orders, "status")),
    order_type_breakdown: formatBreakdown(groupCount(orders, "order_type")),
  };
};

const getTopProductsData = async (range) => {
  const orderItems = await prisma.order_items.findMany({
    where: {
      orders: {
        created_at: {
          gte: range.start,
          lte: range.end,
        },
        status: {
          in: ["completed", "ready", "preparing", "pending"],
        },
      },
    },
  });

  const productMap = {};

  for (const item of orderItems) {
    const key = item.product_id || item.product_name;

    if (!productMap[key]) {
      productMap[key] = {
        product_id: item.product_id,
        product_name: item.product_name,
        total_quantity: 0,
        total_revenue: 0,
      };
    }

    productMap[key].total_quantity += Number(item.quantity || 0);
    productMap[key].total_revenue += Number(item.total || 0);
  }

  return {
    type: "top_products",
    period: range.label,
    top_products: Object.values(productMap)
      .sort((a, b) => b.total_quantity - a.total_quantity)
      .slice(0, 10),
  };
};

const getLowStockData = async () => {
  const products = await prisma.products.findMany({
    where: {
      status: true,
    },
    orderBy: {
      stock_quantity: "asc",
    },
  });

  const lowStockProducts = products
    .filter((product) => Number(product.stock_quantity) <= Number(product.min_stock))
    .map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      stock_quantity: product.stock_quantity,
      min_stock: product.min_stock,
      unit: product.unit,
      selling_price: product.selling_price,
    }));

  return {
    type: "low_stock",
    count: lowStockProducts.length,
    products: lowStockProducts,
  };
};

const getUnpaidOrdersData = async () => {
  const orders = await prisma.orders.findMany({
    where: {
      status: {
        not: "cancelled",
      },
      payment_status: {
        in: ["unpaid", "partial"],
      },
    },
    orderBy: {
      created_at: "desc",
    },
    take: 20,
  });

  return {
    type: "unpaid_orders",
    count: orders.length,
    total_debt: sumAmount(orders, "debt_amount"),
    orders: orders.map((order) => ({
      id: order.id,
      order_code: order.order_code,
      final_amount: order.final_amount,
      paid_amount: order.paid_amount,
      debt_amount: order.debt_amount,
      payment_status: order.payment_status,
      status: order.status,
      created_at: order.created_at,
    })),
  };
};

const getQROrdersData = async (range) => {
  const orders = await getOrdersInRange(range, {
    order_code: {
      startsWith: "QR",
    },
  });

  return {
    type: "qr_orders",
    period: range.label,
    count: orders.length,
    total_amount: sumAmount(orders, "final_amount"),
    orders: orders.map((order) => ({
      order_code: order.order_code,
      table_id: order.table_id,
      final_amount: order.final_amount,
      status: order.status,
      payment_status: order.payment_status,
      created_at: order.created_at,
    })),
  };
};

const getKitchenStatusData = async () => {
  const orders = await prisma.orders.findMany({
    where: {
      status: {
        in: ["pending", "preparing", "ready"],
      },
    },
    orderBy: {
      created_at: "asc",
    },
  });

  return {
    type: "kitchen_status",
    pending: orders.filter((order) => order.status === "pending").length,
    preparing: orders.filter((order) => order.status === "preparing").length,
    ready: orders.filter((order) => order.status === "ready").length,
    orders: orders.map((order) => ({
      order_code: order.order_code,
      status: order.status,
      order_type: order.order_type,
      table_id: order.table_id,
      created_at: order.created_at,
    })),
  };
};

const getPaymentAnalysisData = async (range) => {
  const orders = await getOrdersInRange(range, {
    status: {
      not: "cancelled",
    },
  });

  return {
    type: "payment_analysis",
    period: range.label,
    total_orders: orders.length,
    total_revenue: sumAmount(orders, "final_amount"),
    methods_by_order_count: formatBreakdown(groupCount(orders, "payment_method")),
    methods_by_revenue: formatBreakdown(
      groupAmount(orders, "payment_method", "final_amount")
    ),
  };
};

const getOrderTypeAnalysisData = async (range) => {
  const orders = await getOrdersInRange(range, {
    status: {
      not: "cancelled",
    },
  });

  return {
    type: "order_type_analysis",
    period: range.label,
    total_orders: orders.length,
    types_by_order_count: formatBreakdown(groupCount(orders, "order_type")),
    types_by_revenue: formatBreakdown(groupAmount(orders, "order_type", "final_amount")),
  };
};

const getCancelledOrdersData = async (range) => {
  const orders = await getOrdersInRange(range, {
    status: "cancelled",
  });

  return {
    type: "cancelled_orders",
    period: range.label,
    count: orders.length,
    total_cancelled_value: sumAmount(orders, "final_amount"),
    orders: orders.slice(0, 20).map((order) => ({
      order_code: order.order_code,
      final_amount: order.final_amount,
      payment_status: order.payment_status,
      note: order.note,
      created_at: order.created_at,
    })),
  };
};

const getCustomerSummaryData = async () => {
  const customers = await prisma.customers.findMany({
    where: {
      status: true,
    },
    orderBy: {
      total_spent: "desc",
    },
    take: 10,
  });

  return {
    type: "customer_summary",
    total_customers: await prisma.customers.count({
      where: {
        status: true,
      },
    }),
    top_customers: customers.map((customer) => ({
      id: customer.id,
      full_name: customer.full_name,
      phone: customer.phone,
      total_spent: customer.total_spent,
      debt: customer.debt,
      point: customer.point,
    })),
  };
};

const getGeneralBusinessData = async (range) => {
  const [
    todayOverview,
    revenueSummary,
    topProducts,
    lowStock,
    unpaidOrders,
    qrOrders,
    kitchenStatus,
    paymentAnalysis,
    orderTypeAnalysis,
    cancelledOrders,
    customerSummary,
  ] = await Promise.all([
    getTodayOverviewData(range),
    getRevenueSummaryData(range),
    getTopProductsData(range),
    getLowStockData(),
    getUnpaidOrdersData(),
    getQROrdersData(range),
    getKitchenStatusData(),
    getPaymentAnalysisData(range),
    getOrderTypeAnalysisData(range),
    getCancelledOrdersData(range),
    getCustomerSummaryData(),
  ]);

  return {
    type: "general",
    period: range.label,
    todayOverview,
    revenueSummary,
    topProducts,
    lowStock,
    unpaidOrders,
    qrOrders,
    kitchenStatus,
    paymentAnalysis,
    orderTypeAnalysis,
    cancelledOrders,
    customerSummary,
  };
};

const getBusinessDataByIntent = async (intent, range) => {
  if (intent === "today_overview") return getTodayOverviewData(range);
  if (intent === "revenue_summary") return getRevenueSummaryData(range);
  if (intent === "top_products") return getTopProductsData(range);
  if (intent === "low_stock") return getLowStockData();
  if (intent === "unpaid_orders") return getUnpaidOrdersData();
  if (intent === "qr_orders") return getQROrdersData(range);
  if (intent === "kitchen_status") return getKitchenStatusData();
  if (intent === "payment_analysis") return getPaymentAnalysisData(range);
  if (intent === "order_type_analysis") return getOrderTypeAnalysisData(range);
  if (intent === "cancelled_orders") return getCancelledOrdersData(range);
  if (intent === "customer_summary") return getCustomerSummaryData();

  return getGeneralBusinessData(range);
};

const askBusiness = async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        message: "Question is required",
      });
    }

    const intent = detectIntent(question);
    const dateRange = getDateRangeByQuestion(question);
    const businessData = await getBusinessDataByIntent(intent, dateRange);
    const answer = await askBusinessWithOllama(question, {
      intent,
      period: dateRange.label,
      businessData,
    });

    return res.json({
      success: true,
      message: "Ask business successfully",
      data: {
        question,
        intent,
        period: dateRange.label,
        answer,
        raw_data: businessData,
      },
    });
  } catch (error) {
    console.error("Ask business error:", error?.response?.data || error);

    return res.status(500).json({
      success: false,
      message:
        error?.response?.data?.detail ||
        error.message ||
        "Ask business failed",
    });
  }
};

module.exports = {
  askBusiness,
};
