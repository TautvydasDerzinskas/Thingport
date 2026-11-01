# Weather scene

The current weather as an animated scene that follows the weather, the time of day and the season: sun or moon on
its arc, drifting clouds, rain, snow, fog or lightning, and stars and the moon's phase at night. The temperature,
today's high and low, and optionally the wind and humidity sit on top.

**Landscape** picks what's under the sky, each changing with spring, summer, autumn and winter:

- **Field**: rolling hills and a tree.
- **Forest**: a wood of pines and leafy trees, in layers.
- **Mountains**: snow-capped ranges above a meadow of pines.
- **City**: a street whose windows and lamps light up towards evening.
- **Random**: one of them, picked when the dashboard opens and again each time the time of day turns.

Now and then something passes through, unless **Animals and people passing by** is off. It only happens when it looks
right, so what you see depends on the landscape, the weather and the hour:

| What passes              | Where                       | When                                                        |
| ------------------------ | --------------------------- | ----------------------------------------------------------- |
| Birds                    | Everywhere                  | Dry weather, not at night                                   |
| Deer                     | Field, forest, mountains    | Not in rain, heavy snow or at night                         |
| A dog chasing a ball     | Field, mountains, city      | Dry weather, in the day or at dusk                          |
| A person chasing a ball  | Field, city                 | Dry weather, in the day                                     |
| Someone with an umbrella | City; field in the daylight | Drizzle and rain                                            |
| An owl                   | Field, forest, mountains    | Dry weather, at dusk and at night                           |
| A shooting star          | Everywhere                  | Clear nights                                                |
| A car                    | City                        | Always, with its headlights after dark or in a storm or fog |

Set the place (a city, or `lat,lon`), the units and how often it refreshes from the panel's cog. **Weather shown**,
**Time shown** and **Season shown** draw a fixed scene instead of the live one, to preview them. Animations pause and
nothing passes through for anyone who asks for reduced motion.

Everything it says is in `locales/`, in English, Lithuanian, Spanish and French: the conditions, the readings, and
the words the cog itself shows, which are label keys in `widget.json` so they follow the user's language too. A
language Thingport has that the widget hasn't falls back to English, key by key.

It calls two [Open-Meteo](https://open-meteo.com) services, which need no API key:

- `geocoding-api.open-meteo.com`, to find the city's coordinates (skipped when you give `lat,lon`).
- `api.open-meteo.com`, for the current weather, today's sunrise and sunset, and the high and low.
