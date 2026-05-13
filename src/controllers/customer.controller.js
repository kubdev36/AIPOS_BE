const prisma = require("../config/prisma");

const getCustomers = async (req, res) => {
  try {
    const { search } = req.query;

    const customers = await prisma.customers.findMany({
      where: {
        status: true,
        ...(search && {
          OR: [
            {
              full_name: {
                contains: search,
                mode: "insensitive",
              },
            },
            {
              phone: {
                contains: search,
              },
            },
            {
              email: {
                contains: search,
                mode: "insensitive",
              },
            },
          ],
        }),
      },
      orderBy: {
        id: "desc",
      },
    });

    return res.json({
      success: true,
      data: customers,
    });
  } catch (error) {
    console.error("Get customers error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customers.findUnique({
      where: {
        id: Number(id),
      },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const orders = await prisma.orders.findMany({
      where: {
        customer_id: Number(id),
      },
      orderBy: {
        id: "desc",
      },
    });

    return res.json({
      success: true,
      data: {
        ...customer,
        orders,
      },
    });
  } catch (error) {
    console.error("Get customer by id error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const createCustomer = async (req, res) => {
  try {
    const { full_name, phone, email, address, note } = req.body;

    if (!full_name) {
      return res.status(400).json({
        success: false,
        message: "Customer name is required",
      });
    }

    const customer = await prisma.customers.create({
      data: {
        full_name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        note: note || null,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Create customer successfully",
      data: customer,
    });
  } catch (error) {
    console.error("Create customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      full_name,
      phone,
      email,
      address,
      total_spent,
      debt,
      point,
      note,
      status,
    } = req.body;

    const customer = await prisma.customers.update({
      where: {
        id: Number(id),
      },
      data: {
        ...(full_name !== undefined && { full_name }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(address !== undefined && { address }),
        ...(total_spent !== undefined && {
          total_spent: Number(total_spent),
        }),
        ...(debt !== undefined && {
          debt: Number(debt),
        }),
        ...(point !== undefined && {
          point: Number(point),
        }),
        ...(note !== undefined && { note }),
        ...(status !== undefined && { status: Boolean(status) }),
      },
    });

    return res.json({
      success: true,
      message: "Update customer successfully",
      data: customer,
    });
  } catch (error) {
    console.error("Update customer error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.customers.update({
      where: {
        id: Number(id),
      },
      data: {
        status: false,
      },
    });

    return res.json({
      success: true,
      message: "Delete customer successfully",
    });
  } catch (error) {
    console.error("Delete customer error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
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
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};