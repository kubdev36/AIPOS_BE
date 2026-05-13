const express = require("express");
const router = express.Router();

const orderController = require("../controllers/order.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/", authMiddleware, orderController.getOrders);
router.get("/:id", authMiddleware, orderController.getOrderById);
router.post("/", authMiddleware, orderController.createOrder);
router.put("/:id/cancel", authMiddleware, orderController.cancelOrder);

module.exports = router;