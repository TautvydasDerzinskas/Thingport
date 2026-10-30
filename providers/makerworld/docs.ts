import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own session cookie; Thingport Grab connects it for you.",
  about:
    "Bambu Lab's model site, and the one that put print profiles front and centre: models arrive tuned for a machine and a filament, ready to send to the printer. Designers earn points for them, which buy Bambu gear in its shop.",
  description: "Import MakerWorld models with their print profiles, using your own session cookie.",
  signIn: "Your cookie",
  highlight: {
    title: "Sync big collections through Grab",
    text: "MakerWorld rate-limits bulk imports, so a sync started in Thingport only picks up new models. Start it from the collection's page with Thingport Grab, which paces the import and brings in the rest too.",
    link: "guides/synced-collections#turn-sync-on-with-thingport-grab",
  },
} satisfies ProviderDocs;
