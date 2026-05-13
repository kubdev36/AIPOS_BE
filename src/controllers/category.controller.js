const prisma = require("../config/prisma");

const getCategories = async (req, res) => {
  try {
    const categories = await prisma.categories.findMany({
      orderBy: {
        id: "desc",
      },
    });

    return res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Get categories error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    const category = await prisma.categories.create({
      data: {
        name,
        description: description || null,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Create category successfully",
      data: category,
    });
  } catch (error) {
    console.error("Create category error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, status } = req.body;

    const category = await prisma.categories.update({
      where: {
        id: Number(id),
      },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
      },
    });

    return res.json({
      success: true,
      message: "Update category successfully",
      data: category,
    });
  } catch (error) {
    console.error("Update category error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.categories.update({
      where: {
        id: Number(id),
      },
      data: {
        status: false,
      },
    });

    return res.json({
      success: true,
      message: "Delete category successfully",
    });
  } catch (error) {
    console.error("Delete category error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};