const express = require("express");
const router = express.Router();

const categoryController = require("../controllers/category.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");

router.get(
  "/",
  authMiddleware,
  roleMiddleware("admin", "manager", "staff"),
  categoryController.getCategories
);
router.post(
  "/",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  categoryController.createCategory
);
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  categoryController.updateCategory
);
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("admin"),
  categoryController.deleteCategory
);

module.exports = router;
