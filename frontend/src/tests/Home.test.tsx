import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Home from "../pages/Home";

// Mock API
vi.mock("../services/api", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock react-hot-toast
vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Home Page", () => {
  it("renders loading state initially", () => {
    render(<Home />);

    expect(screen.getByText(/Loading Task Manager/i)).toBeInTheDocument();
  });
});