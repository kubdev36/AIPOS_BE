const express = require("express");
const router = express.Router();

const toppingController = require("../controllers/topping.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/", authMiddleware, toppingController.getToppings);
router.get("/:id", authMiddleware, toppingController.getToppingById);
router.post("/", authMiddleware, toppingController.createTopping);
router.put("/:id", authMiddleware, toppingController.updateTopping);
router.delete("/:id", authMiddleware, toppingController.deleteTopping);

module.exports = router;