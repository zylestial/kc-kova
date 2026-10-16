import type { MetadataRoute } from "next";

// Lets KOVA be added to a phone's Home Screen, which iPhones require before
// they allow notifications (public/sw.js shows them).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KOVA",
    short_name: "KOVA",
    description: "Kayelen's Operations and Vehicle Allocation.",
    start_url: "/home",
    display: "standalone",
    background_color: "#f4f6fa",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
