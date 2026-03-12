import { useMemo } from "react";
import { useResources } from "./use-resources";
import type { Resource, ResourceType } from "@/types/resource";

/** Resources grouped by type and trunk line for the current site */
export function useSiteResources() {
  const { data: resources = [], isLoading, error } = useResources();

  const grouped = useMemo(() => {
    const groups: Record<string, Resource[]> = {};

    for (const resource of resources) {
      const key = resource.groupName ?? resource.trunkLine ?? resource.resourceType;
      if (!groups[key]) groups[key] = [];
      groups[key].push(resource);
    }

    return groups;
  }, [resources]);

  const byType = useMemo(() => {
    const map: Record<ResourceType, Resource[]> = {
      mixer: [],
      disperser: [],
      pot: [],
    };

    for (const resource of resources) {
      map[resource.resourceType]?.push(resource);
    }

    return map;
  }, [resources]);

  return { resources, grouped, byType, isLoading, error };
}
