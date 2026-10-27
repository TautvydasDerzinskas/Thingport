# The libraries a generator script can include

OpenSCAD scripts in the wild are written against a handful of well-known libraries, and a script that includes
one won't run without it. These are the copies Thingport mounts for the engine in `../openscad`, so a model
downloaded from a site that bundles the same libraries generates here too.

They are fetched only when the script being run actually mentions one, so an ordinary script costs nothing.

## BOSL2

The Belfry OpenSCAD Library, v2 -- **version 2.0.780**, the top-level `.scad` files exactly as published. It is by
far the most common dependency: of sixteen real scripts surveyed from MakerWorld, nine included it and nothing
else included anything.

Only the top level is here. `BOSL2/std.scad` and its siblings include each other by bare filename and reach into
no subdirectory, so the examples and tests the upstream repository also carries would never be read.

Under the **BSD 2-Clause License**, whose text and copyright notice are in `BOSL2/LICENSE`, from
<https://github.com/BelfrySCAD/BOSL2>.

## Adding another

Copy its `.scad` files in beside this file under the name scripts include it by -- the folder name is the name
`include <Name/...>` will look for -- and bring its licence with it. Nothing else needs changing: the loader
picks up whatever is here.
