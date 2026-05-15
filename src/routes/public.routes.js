const express = require("express");
const router = express.Router();

const publicController = require("../controllers/public.controller");

router.get("/menu", publicController.getPublicMenu);
router.get("/tables/:id", publicController.getPublicTable);
router.post("/orders", publicController.createPublicOrder);
router.post("/ai/parse-order", publicController.parsePublicAIOrder);

module.exports = router;