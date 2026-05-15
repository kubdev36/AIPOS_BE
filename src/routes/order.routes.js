const express = require("express");
const router = express.Router();

const orderController = require("../controllers/order.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");

router.get(
  "/",
  authMiddleware,
  roleMiddleware("admin", "manager", "staff"),
  orderController.getOrders
);
router.get(
  "/:id",
  authMiddleware,
  roleMiddleware("admin", "manager", "staff"),
  orderController.getOrderById
);
router.post(
  "/",
  authMiddleware,
  roleMiddleware("admin", "manager", "staff"),
  orderController.createOrder
);
router.put(
  "/:id/cancel",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  orderController.cancelOrder
);

module.exports = router;
