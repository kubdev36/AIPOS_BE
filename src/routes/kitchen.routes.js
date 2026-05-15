const express = require("express");
const router = express.Router();

const kitchenController = require("../controllers/kitchen.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");

router.get(
  "/orders",
  authMiddleware,
  roleMiddleware("admin", "manager", "kitchen"),
  kitchenController.getKitchenOrders
);

router.put(
  "/orders/:id/status",
  authMiddleware,
  roleMiddleware("admin", "manager", "kitchen"),
  kitchenController.updateKitchenOrderStatus
);

module.exports = router;