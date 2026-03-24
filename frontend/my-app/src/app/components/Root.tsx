import { Outlet } from 'react-router';

export function Root() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Outlet />
    </div>
  );
}
