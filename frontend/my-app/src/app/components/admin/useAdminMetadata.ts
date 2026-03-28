import { useCallback, useEffect, useState } from 'react';

import API_ENDPOINTS from '../../../api/config';
import { useApiClient } from '../../apiClient';
import type {
  AdminCategory,
  AdminMachine,
  AdminUser,
  DepartmentOption,
} from './adminTypes';

interface AdminMetadataState {
  departments: DepartmentOption[];
  categories: AdminCategory[];
  machines: AdminMachine[];
  users: AdminUser[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export const useAdminMetadata = (): AdminMetadataState => {
  const { apiCall } = useApiClient();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [machines, setMachines] = useState<AdminMachine[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [departmentsResponse, categoriesResponse, machinesResponse, usersResponse] = await Promise.all([
        apiCall(API_ENDPOINTS.ADMIN_METADATA_DEPARTMENTS),
        apiCall(API_ENDPOINTS.ADMIN_METADATA_CATEGORIES),
        apiCall(API_ENDPOINTS.ADMIN_METADATA_MACHINES),
        apiCall(API_ENDPOINTS.ADMIN_METADATA_USERS),
      ]);

      const [departmentsData, categoriesData, machinesData, usersData] = await Promise.all([
        departmentsResponse.ok ? departmentsResponse.json() : [],
        categoriesResponse.ok ? categoriesResponse.json() : [],
        machinesResponse.ok ? machinesResponse.json() : [],
        usersResponse.ok ? usersResponse.json() : [],
      ]);

      setDepartments(departmentsData);
      setCategories(categoriesData);
      setMachines(machinesData);
      setUsers(usersData);
    } finally {
      setIsLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { departments, categories, machines, users, isLoading, refresh };
};
