export const regionProfiles = {
  MX: { locale: "es_MX", currency: "MXN", region: "mx", country: "Mexico" },
  US: { locale: "en_US", currency: "USD", region: "us", country: "United States" },
  ES: { locale: "es_ES", currency: "EUR", region: "es", country: "Espana" },
  IT: { locale: "it_IT", currency: "EUR", region: "it", country: "Italia" },
  CA: { locale: "en_CA", currency: "CAD", region: "ca", country: "Canada" }
};

export function createProfile(regionKey) {
  const profile = regionProfiles[regionKey];
  if (!profile) {
    throw new Error(`Region no soportada: ${regionKey}`);
  }
  return {
    ...profile,
    profile_id: `profile_${Date.now()}`,
    profile_state: "profile_created"
  };
}
