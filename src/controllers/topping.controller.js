const prisma = require("../config/prisma");

const getToppings = async (req, res) => {
  try {
    const toppings = await prisma.toppings.findMany({
      where: {
        status: true,
      },
      orderBy: {
        id: "desc",
      },
    });

    return res.json({
      success: true,
      data: toppings,
    });
  } catch (error) {
    console.error("Get toppings error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getToppingById = async (req, res) => {
  try {
    const { id } = req.params;

    const topping = await prisma.toppings.findUnique({
      where: {
        id: Number(id),
      },
    });

    if (!topping) {
      return res.status(404).json({
        success: false,
        message: "Topping not found",
      });
    }

    return res.json({
      success: true,
      data: topping,
    });
  } catch (error) {
    console.error("Get topping by id error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const createTopping = async (req, res) => {
  try {
    const { name, price } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Topping name is required",
      });
    }

    if (price === undefined || Number(price) < 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be greater than or equal to 0",
      });
    }

    const topping = await prisma.toppings.create({
      data: {
        name,
        price: Number(price),
      },
    });

    return res.status(201).json({
      success: true,
      message: "Create topping successfully",
      data: topping,
    });
  } catch (error) {
    console.error("Create topping error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateTopping = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, status } = req.body;

    const topping = await prisma.toppings.update({
      where: {
        id: Number(id),
      },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price: Number(price) }),
        ...(status !== undefined && { status: Boolean(status) }),
      },
    });

    return res.json({
      success: true,
      message: "Update topping successfully",
      data: topping,
    });
  } catch (error) {
    console.error("Update topping error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Topping not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteTopping = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.toppings.update({
      where: {
        id: Number(id),
      },
      data: {
        status: false,
      },
    });

    return res.json({
      success: true,
      message: "Delete topping successfully",
    });
  } catch (error) {
    console.error("Delete topping error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Topping not found",
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
  getToppings,
  getToppingById,
  createTopping,
  updateTopping,
  deleteTopping,
};