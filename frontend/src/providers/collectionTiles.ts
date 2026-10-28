// Each provider's collection tile in the sync dialog, drawn in that site's own manner; GenericTile
// (pages/CollectionDetailPage/ProviderCollectionTile.tsx) for one without.

import type { BrowsableProvider } from "../api/providerCollections";
import type { SkeletonProps, TileProps } from "./collectionTile";
import * as makerworld from "./makerworld/CollectionTile";
import * as printables from "./printables/CollectionTile";
import * as thingiverse from "./thingiverse/CollectionTile";
import * as myminifactory from "./myminifactory/CollectionTile";
import * as snapmaker from "./snapmaker/CollectionTile";
import * as makeronline from "./makeronline/CollectionTile";
import * as crealitycloud from "./crealitycloud/CollectionTile";
import * as nexprint from "./nexprint/CollectionTile";
import * as thangs from "./thangs/CollectionTile";
import * as cults3d from "./cults3d/CollectionTile";
import * as eufymake from "./eufymake/CollectionTile";
import * as pinshape from "./pinshape/CollectionTile";
import * as toymakr3d from "./toymakr3d/CollectionTile";

type Own = { Tile: (props: TileProps) => JSX.Element; TileSkeleton: (props: SkeletonProps) => JSX.Element };

export const COLLECTION_TILES: Partial<Record<BrowsableProvider, Own>> = {
  makerworld,
  printables,
  thingiverse,
  myminifactory,
  snapmaker,
  makeronline,
  crealitycloud,
  nexprint,
  thangs,
  cults3d,
  eufymake,
  pinshape,
  toymakr3d,
};
