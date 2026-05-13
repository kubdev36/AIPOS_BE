const express = require("express");
const router = express.Router();

const categoryController = require("../controllers/category.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/", authMiddleware, categoryController.getCategories);
router.post("/", authMiddleware, categoryController.createCategory);
router.put("/:id", authMiddleware, categoryController.updateCategory);
router.delete("/:id", authMiddleware, categoryController.deleteCategory);

module.exports = router;