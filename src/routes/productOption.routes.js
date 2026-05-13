const express = require("express");
const router = express.Router();

const productOptionController = require("../controllers/productOption.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get(
  "/product/:product_id",
  authMiddleware,
  productOptionController.getOptionsByProduct
);

router.post("/", authMiddleware, productOptionController.createOption);
router.put("/:id", authMiddleware, productOptionController.updateOption);
router.delete("/:id", authMiddleware, productOptionController.deleteOption);

module.exports = router;