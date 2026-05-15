const express = require("express");
const router = express.Router();

const productController = require("../controllers/product.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");

router.get(
  "/",
  authMiddleware,
  roleMiddleware("admin", "manager", "staff"),
  productController.getProducts
);
router.get(
  "/:id",
  authMiddleware,
  roleMiddleware("admin", "manager", "staff"),
  productController.getProductById
);
router.post(
  "/",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  productController.createProduct
);
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  productController.updateProduct
);
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("admin"),
  productController.deleteProduct
);

module.exports = router;
