const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth.routes");
const categoryRoutes = require("./routes/category.routes");
const productRoutes = require("./routes/product.routes");
const orderRoutes = require("./routes/order.routes");
const toppingRoutes = require("./routes/topping.routes");
const productOptionRoutes = require("./routes/productOption.routes");
const customerRoutes = require("./routes/customer.routes");
const reportRoutes = require("./routes/report.routes");
const aiRoutes = require("./routes/ai.routes");
const faceRoutes = require("./routes/face.routes");
const userRoutes = require("./routes/user.routes");
const kitchenRoutes = require("./routes/kitchen.routes");
const publicRoutes = require("./routes/public.routes");
const businessAIRoutes = require("./routes/businessAI.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "AI F&B POS API is running",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/toppings", toppingRoutes);
app.use("/api/product-options", productOptionRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/face", faceRoutes);
app.use("/api/users", userRoutes);
app.use("/api/kitchen", kitchenRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/business-ai", businessAIRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});