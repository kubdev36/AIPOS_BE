const express = require("express");
const router = express.Router();

const reportController = require("../controllers/report.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");

router.get(
  "/overview",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  reportController.getOverviewReport
);
router.get(
  "/revenue-7-days",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  reportController.getRevenueLast7Days
);
router.get(
  "/top-products",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  reportController.getTopProducts
);
router.get(
  "/low-stock",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  reportController.getLowStockProducts
);
router.get(
  "/revenue",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  reportController.getRevenueByDateRange
);

module.exports = router;
