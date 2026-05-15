const express = require("express");
const router = express.Router();

const businessAIController = require("../controllers/businessAI.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");

router.post(
  "/ask-business",
  authMiddleware,
  roleMiddleware("admin", "manager"),
  businessAIController.askBusiness
);

module.exports = router;