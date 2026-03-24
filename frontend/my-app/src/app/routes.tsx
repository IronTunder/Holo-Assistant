import { createBrowserRouter } from "react-router";
import { Root } from "./components/Root";
import { OperatorInterface } from "./components/operator/OperatorInterface";
import { NotFound } from "./components/NotFound";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: OperatorInterface },
      { path: "*", Component: NotFound },
    ],
  },
]);