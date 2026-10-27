# The fonts tools letter things with

Twenty-one typefaces, offered to tools through the SDK's `library("fonts")`, so a tool that puts text on a model
can do it offline and without carrying a copy of its own. They are here unmodified, exactly as Google Fonts
publishes them.

Every one is a **static** font, and deliberately so. A variable font's outlines only come out right once its
deltas have been applied, which the font parser Thingport carries doesn't do: the letters come back collapsed or
with their contours wound the same way, and a letter whose counter has lost its winding turns into a filled blob
when it's made solid. The keyring generator's own tests measure every file here for exactly that, so a font added
later can't quietly reintroduce it. Where a family ships several weights, the bold one is here, because thin
strokes don't survive printing.

Every one is under the SIL Open Font License, Version 1.1, whose text is in `OFL.txt` beside this file. The
licence asks that it travel with the fonts and that the copyright notices be kept, which is what this file is
for. Several carry a Reserved Font Name: those names may not be used for a modified version, so if one of these
files is ever changed rather than replaced, it has to be renamed first.

| File                | Typeface       | Copyright                                                                                                                       |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pt-sans.ttf`       | PT Sans Bold   | ﻿Copyright (c) 2010, ParaType Ltd. (http://www.paratype.com/public),                                                            |
| `fira-sans.ttf`     | Fira Sans Bold | Copyright (c) 2012-2015, The Mozilla Foundation and Telefonica S.A.                                                             |
| `fjalla-one.ttf`    | Fjalla One     | Copyright 2012 The Fjalla One Project Authors (https://github.com/SorkinType/FjallaOne)                                         |
| `bebas-neue.ttf`    | Bebas Neue     | Copyright © 2010 by Dharma Type.                                                                                                |
| `staatliches.ttf`   | Staatliches    | Copyright 2018 The Staatliches Authors (https://github.com/googlefonts/staatliches)                                             |
| `pt-serif.ttf`      | PT Serif Bold  | Copyright (c) 2010, ParaType Ltd. (http://www.paratype.com/public),                                                             |
| `arvo.ttf`          | Arvo Bold      | Copyright (c) 2010-2013, Anton Koovit (anton@korkork.com), with Reserved Font Name 'Arvo'                                       |
| `abril-fatface.ttf` | Abril Fatface  | Copyright (c) 2011, TypeTogether (www.type-together.com),                                                                       |
| `alfa-slab-one.ttf` | Alfa Slab One  | Copyright 2016 The Alfa Slab One Project Authors (http://www.jmsole.cl \| info@jmsole.cl), with Reserved Font Name "Alfa Slab". |
| `anton.ttf`         | Anton          | Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git)                                         |
| `archivo-black.ttf` | Archivo Black  | Copyright 2017 The Archivo Black Project Authors (https://github.com/Omnibus-Type/ArchivoBlack)                                 |
| `bowlby-one.ttf`    | Bowlby One     | Copyright (c) 2011 by vernon adams (vern@newtypography.co.uk),                                                                  |
| `sigmar-one.ttf`    | Sigmar One     | Copyright 2011 The Sigmar One Project Authors (contact@sansoxygen.com)                                                          |
| `titan-one.ttf`     | Titan One      | Copyright (c) 2011, Rodrigo Fuenzalida (www.rfuenzalida.com\|hello@rfuenzalida.com),                                            |
| `concert-one.ttf`   | Concert One    | Copyright (c) 2011 Johan Kallas (johankallas@gmail.com),                                                                        |
| `patua-one.ttf`     | Patua One      | Copyright (c) 2011 by LatinoType Limitada (luciano@latinotype.com),                                                             |
| `bungee.ttf`        | Bungee         | Copyright 2023 The Bungee Project Authors (https://github.com/djrrb/Bungee)                                                     |
| `righteous.ttf`     | Righteous      | Copyright (c) 2011 by Brian J. Bonislawsky DBA Astigmatic (AOETI)                                                               |
| `russo-one.ttf`     | Russo One      | Copyright (c) 2011-2012, Jovanny Lemonad (jovanny.ru), with Reserved Font Name "Russo"                                          |
| `lobster.ttf`       | Lobster        | Copyright 2010 The Lobster Project Authors (https://github.com/impallari/The-Lobster-Font), with Reserved Font Name "Lobster".  |
| `pacifico.ttf`      | Pacifico       | Copyright 2018 The Pacifico Project Authors (https://github.com/googlefonts/Pacifico)                                           |
