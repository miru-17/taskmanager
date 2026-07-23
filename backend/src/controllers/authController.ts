import { Request, Response } from "express";
import prisma from "../prisma";

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";


// =====================================================
// REGISTER
// =====================================================

export const register = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    let { email, password } = req.body;

    email = email.trim().toLowerCase();

    if (!email) {
      res.status(400).json({
        message: "Email is required",
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      res.status(400).json({
        message: "Invalid email format",
      });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).json({
        message: "Password must be at least 6 characters",
      });
      return;
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      res.status(409).json({
        message: "Email already registered",
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};


// =====================================================
// LOGIN
// =====================================================

export const login = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    let { email, password } = req.body;

    email = email.trim().toLowerCase();

    if (!email || !password) {
      res.status(400).json({
        message: "Email and password are required",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      res.status(401).json({
        message: "Invalid email or password",
      });
      return;
    }

    const isMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!isMatch) {
      res.status(401).json({
        message: "Invalid email or password",
      });
      return;
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
      },
      process.env.JWT_SECRET as string,
      {
        expiresIn: "1d",
      }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};


// =====================================================
// FORGOT PASSWORD
// =====================================================

export const forgotPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      res.status(404).json({
        message: "User not found",
      });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString("hex");

    const resetTokenExpiry = new Date(
      Date.now() + 15 * 60 * 1000
    );

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        resetToken,
        resetTokenExpiry,
      },
    });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const resetLink = `http://localhost:5173/reset-password/${resetToken}`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Reset Password",

      html: `
        <h2>Password Reset</h2>

        <p>You requested a password reset.</p>

        <p>
          Click the link below to reset your password:
        </p>

        <a href="${resetLink}">
          Reset Password
        </a>

        <p>This link expires in 15 minutes.</p>
      `,
    });

    res.status(200).json({
      message: "Password reset email sent successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};


// =====================================================
// RESET PASSWORD
// =====================================================

// =====================================================
// GET RESET USER EMAIL
// =====================================================

export const getResetUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const token = req.params.token as string;

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      res.status(400).json({
        message: "Invalid or expired reset token",
      });
      return;
    }

    res.status(200).json({
      email: user.email,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};



// =====================================================
// RESET PASSWORD
// =====================================================

export const resetPassword = async (
  req: Request,
  res: Response
): Promise<void> => {

  try {

    const token = req.params.token as string;

    const { password } = req.body;


    if (!password || password.length < 6) {

      res.status(400).json({
        message: "Password must be at least 6 characters",
      });

      return;
    }



    const user = await prisma.user.findFirst({

      where: {

        resetToken: token,

        resetTokenExpiry: {
          gt: new Date(),
        },

      },

    });



    if (!user) {

      res.status(400).json({
        message: "Invalid or expired reset token",
      });

      return;

    }



    const hashedPassword = await bcrypt.hash(
      password,
      10
    );



    await prisma.user.update({

      where: {

        id: user.id,

      },

      data: {

        password: hashedPassword,

        resetToken: null,

        resetTokenExpiry: null,

      },

    });



    res.status(200).json({

      message: "Password reset successful",

    });



  } catch (error) {

    console.error(error);


    res.status(500).json({

      message: "Internal Server Error",

    });

  }

};