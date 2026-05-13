const prisma = require("../config/prisma");

const MANAGEABLE_ROLES = new Set(["admin", "manager"]);

const ensureCanManageUsers = (req, res) => {
  if (MANAGEABLE_ROLES.has(req.user?.role)) {
    return true;
  }

  res.status(403).json({
    success: false,
    message: "Ban khong co quyen thuc hien thao tac nay",
  });
  return false;
};

const getUsers = async (req, res) => {
  try {
    const users = await prisma.users.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        branch_id: true,
        full_name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        created_at: true,
      },
    });

    return res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("Get users error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteUser = async (req, res) => {
  try {
    if (!ensureCanManageUsers(req, res)) {
      return;
    }

    const userId = Number(req.params.id);

    if (req.user.id === userId) {
      return res.status(400).json({
        success: false,
        message: "Ban khong the tu xoa tai khoan dang dang nhap",
      });
    }

    const user = await prisma.users.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: {
          id: userId,
        },
        data: {
          status: false,
        },
      });

      await tx.face_profiles.updateMany({
        where: {
          user_id: userId,
        },
        data: {
          status: false,
        },
      });
    });

    return res.json({
      success: true,
      message: "Xoa tai khoan thanh cong",
    });
  } catch (error) {
    console.error("Delete user error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const restoreUser = async (req, res) => {
  try {
    if (!ensureCanManageUsers(req, res)) {
      return;
    }

    const userId = Number(req.params.id);
    const user = await prisma.users.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: {
          id: userId,
        },
        data: {
          status: true,
        },
      });

      await tx.face_profiles.updateMany({
        where: {
          user_id: userId,
        },
        data: {
          status: true,
        },
      });
    });

    return res.json({
      success: true,
      message: "Khoi phuc tai khoan thanh cong",
    });
  } catch (error) {
    console.error("Restore user error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteMyAccount = async (req, res) => {
  try {
    const userId = Number(req.user.id);

    await prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: {
          id: userId,
        },
        data: {
          status: false,
        },
      });

      await tx.face_profiles.updateMany({
        where: {
          user_id: userId,
        },
        data: {
          status: false,
        },
      });
    });

    return res.json({
      success: true,
      message: "Tai khoan cua ban da duoc xoa",
    });
  } catch (error) {
    console.error("Delete my account error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getUsers,
  deleteUser,
  restoreUser,
  deleteMyAccount,
};
