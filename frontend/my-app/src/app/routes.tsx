import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { createBrowserRouter } from "react-router";
import { Root } from "./Root";
import { NotFound } from "./NotFound";
import { OperatorRoute } from "./OperatorRoute";
import { ProtectedRoute } from "./ProtectedRoute";

const OperatorInterface = lazy(() =>
  import("@/features/operator/OperatorInterface").then((module) => ({
    default: module.OperatorInterface,
  }))
);

const AdminLogin = lazy(() =>
  import("@/features/admin/AdminLogin").then((module) => ({
    default: module.AdminLogin,
  }))
);

const AdminDashboard = lazy(() =>
  import("@/features/admin/AdminDashboard").then((module) => ({
    default: module.AdminDashboard,
  }))
);

function RouteFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
        <p className="text-gray-600">Caricamento in corso...</p>
      </div>
    </div>
  );
}

function withSuspense(Component: LazyExoticComponent<ComponentType>) {
  return function SuspendedRouteComponent() {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Component />
      </Suspense>
    );
  };
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      {
        Component: OperatorRoute,
        children: [
          { index: true, Component: withSuspense(OperatorInterface) },
        ],
      },
      {
        path: "admin-login",
        Component: withSuspense(AdminLogin),
      },
      {
        path: "admin",
        Component: ProtectedRoute,
        children: [
          { index: true, Component: withSuspense(AdminDashboard) },
        ],
      },
      { path: "*", Component: NotFound },
    ],
  },
]);
