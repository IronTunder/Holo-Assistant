import { useCallback, useEffect, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import type {
  AdminCategory,
  AdminMachine,
  AdminWorkingStation,
  AdminUser,
  DepartmentOption,
  RoleOption,
} from './adminTypes';

interface AdminMetadataState {
  departments: DepartmentOption[];
  categories: AdminCategory[];
  machines: AdminMachine[];
  workingStations: AdminWorkingStation[];
  users: AdminUser[];
  roles: RoleOption[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export const useAdminMetadata = (): AdminMetadataState => {
  const { apiCall } = useApiClient();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [machines, setMachines] = useState<AdminMachine[]>([]);
  const [workingStations, setWorkingStations] = useState<AdminWorkingStation[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [departmentsResponse, categoriesResponse, machinesResponse, workingStationsResponse, usersResponse, rolesResponse] = await Promise.all([
        apiCall(API_ENDPOINTS.ADMIN_METADATA_DEPARTMENTS),
        apiCall(API_ENDPOINTS.ADMIN_METADATA_CATEGORIES),
        apiCall(API_ENDPOINTS.ADMIN_METADATA_MACHINES),
        apiCall(API_ENDPOINTS.ADMIN_METADATA_WORKING_STATIONS),
        apiCall(API_ENDPOINTS.ADMIN_METADATA_USERS),
        apiCall(API_ENDPOINTS.ADMIN_METADATA_ROLES),
      ]);

      const [departmentsData, categoriesData, machinesData, workingStationsData, usersData, rolesData] = await Promise.all([
        departmentsResponse.ok ? departmentsResponse.json() : [],
        categoriesResponse.ok ? categoriesResponse.json() : [],
        machinesResponse.ok ? machinesResponse.json() : [],
        workingStationsResponse.ok ? workingStationsResponse.json() : [],
        usersResponse.ok ? usersResponse.json() : [],
        rolesResponse.ok ? rolesResponse.json() : [],
      ]);

      setDepartments(departmentsData);
      setCategories(categoriesData);
      setMachines(machinesData);
      setWorkingStations(workingStationsData);
      setUsers(usersData);
      setRoles(rolesData);
    } finally {
      setIsLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { departments, categories, machines, workingStations, users, roles, isLoading, refresh };
};
