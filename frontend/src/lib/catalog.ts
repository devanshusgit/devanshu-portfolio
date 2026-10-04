import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { FeatureInfo, MaterialInfo, VirtualObject } from "@/api/types";

/** Static catalogues served by the backend (single source of truth). */
export function useCatalog() {
  const objects = useQuery({ queryKey: ["objects"], queryFn: api.objects, staleTime: Infinity });
  const materials = useQuery({ queryKey: ["materials"], queryFn: api.materials, staleTime: Infinity });
  const features = useQuery({ queryKey: ["features"], queryFn: api.features, staleTime: Infinity });
  const objectList: VirtualObject[] = objects.data?.objects ?? [];
  const objectById = Object.fromEntries(objectList.map((o) => [o.id, o])) as Record<string, VirtualObject>;
  const materialList: MaterialInfo[] = materials.data?.materials ?? [];
  const materialByName = Object.fromEntries(materialList.map((m) => [m.name, m])) as Record<string, MaterialInfo>;
  const featureList: FeatureInfo[] = features.data?.features ?? [];
  return {
    ready: objects.isSuccess && materials.isSuccess && features.isSuccess,
    error: objects.error ?? materials.error ?? features.error,
    isLoading: objects.isLoading || materials.isLoading || features.isLoading,
    refetch: () => {
      objects.refetch();
      materials.refetch();
      features.refetch();
    },
    objects: objectList,
    objectById,
    materials: materialList,
    materialByName,
    features: featureList,
    defaultObjectForMaterial: objects.data?.default_object_for_material ?? {},
    gripNote: materials.data?.grip_note ?? "",
  };
}
