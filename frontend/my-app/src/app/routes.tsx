import { createBrowserRouter } from "react-router";
import { Root } from "./components/Root";
import { OperatorInterface } from "./components/operator/OperatorInterface";
import { NotFound } from "./components/NotFound";
import { AdminLogin } from "./components/admin/AdminLogin";
import { AdminDashboard } from "./components/admin/AdminDashboard";
import { ProtectedRoute } from "./components/ProtectedRoute";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: OperatorInterface },
      {
        path: "admin-login",
        Component: AdminLogin,
      },
      {
        path: "admin",
        Component: ProtectedRoute,
        children: [
          { index: true, Component: AdminDashboard },
        ],
      },
      { path: "*", Component: NotFound },
    ],
  },
]);