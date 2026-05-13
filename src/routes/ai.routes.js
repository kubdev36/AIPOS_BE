const express = require("express");
const multer = require("multer");
const router = express.Router();

const aiController = require("../controllers/ai.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.post("/parse-order", authMiddleware, aiController.parseOrder);
router.post(
  "/parse-menu",
  authMiddleware,
  upload.single("file"),
  aiController.parseMenu
);

module.exports = router;
