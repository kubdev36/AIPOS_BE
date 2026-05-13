const prisma = require("../config/prisma");

const getOptionsByProduct = async (req, res) => {
  try {
    const { product_id } = req.params;

    const options = await prisma.product_options.findMany({
      where: {
        product_id: Number(product_id),
        status: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    return res.json({
      success: true,
      data: options,
    });
  } catch (error) {
    console.error("Get options by product error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const createOption = async (req, res) => {
  try {
    const { product_id, option_name, extra_price } = req.body;

    if (!product_id || !option_name) {
      return res.status(400).json({
        success: false,
        message: "Product ID and option name are required",
      });
    }

    const product = await prisma.products.findUnique({
      where: {
        id: Number(product_id),
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const option = await prisma.product_options.create({
      data: {
        product_id: Number(product_id),
        option_name,
        extra_price: Number(extra_price || 0),
      },
    });

    return res.status(201).json({
      success: true,
      message: "Create product option successfully",
      data: option,
    });
  } catch (error) {
    console.error("Create option error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateOption = async (req, res) => {
  try {
    const { id } = req.params;
    const { option_name, extra_price, status } = req.body;

    const option = await prisma.product_options.update({
      where: {
        id: Number(id),
      },
      data: {
        ...(option_name !== undefined && { option_name }),
        ...(extra_price !== undefined && {
          extra_price: Number(extra_price),
        }),
        ...(status !== undefined && {
          status: Boolean(status),
        }),
      },
    });

    return res.json({
      success: true,
      message: "Update product option successfully",
      data: option,
    });
  } catch (error) {
    console.error("Update option error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Product option not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteOption = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.product_options.update({
      where: {
        id: Number(id),
      },
      data: {
        status: false,
      },
    });

    return res.json({
      success: true,
      message: "Delete product option successfully",
    });
  } catch (error) {
    console.error("Delete option error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Product option not found",
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
  getOptionsByProduct,
  createOption,
  updateOption,
  deleteOption,
};