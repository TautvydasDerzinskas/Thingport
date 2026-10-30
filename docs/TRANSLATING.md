# Translating Thingport

Thingport's interface is translated with one JSON file per language in
[frontend/src/i18n/locales/](../frontend/src/i18n/locales/). Add a file and the language appears in
**Configuration → Appearance** and in the <kbd>!language</kbd> search command, named in its own language. There's
nothing to register or wire up.

A translation doesn't have to be finished to be useful: any text not translated yet shows in English, so you can
send a partial translation and fill it in later.

## Add a language

1. Copy [`en.json`](../frontend/src/i18n/locales/en.json) to a file named after the language's
   [code](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes): `es.json` for Spanish, `fr.json` for French.
   Add a region only for a regional variant that differs enough to need its own file, as in `pt-BR.json`.
2. Translate the values, the text on the right of each `:`. Leave the keys on the left as they are.
3. Open a pull request against `develop`, as in [CONTRIBUTING.md](../CONTRIBUTING.md). Its title can be
   `feat(i18n): add Spanish translation`.

You can do all of this in the browser: open `en.json` on GitHub, copy its contents, then use **Add file → Create new
file** in the `locales` folder, and GitHub offers to fork the repository and open the pull request for you.

To improve an existing language, edit its file the same way; the commit type is then `fix(i18n):`.

## What to keep as it is

- **Placeholders** in double braces, such as `{{count}}` or `{{name}}`, are filled in by Thingport. Keep them,
  spelled exactly the same, but move them to wherever the sentence needs them.
- **Names** of Thingport, Thingport Grab and the model sites (MakerWorld, Printables, Thingiverse and so on) stay
  as they are.

## Plurals

Text that depends on a number has one key per plural form, ending in `_zero`, `_one`, `_two`, `_few`, `_many`
or `_other`:

```json
"minutesAgo_one": "{{count}} minute ago",
"minutesAgo_other": "{{count}} minutes ago"
```

Use the forms your language needs, which aren't always English's: Lithuanian, for example, adds `_few`, and Arabic
and Welsh also use `_zero` and `_two`. Check your language in the
[Unicode plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) and add or
drop forms to match; `i18n:check` below lists any form your language is missing.

## Check your translation

With the [development setup](DEVELOPMENT.md) running, pick your language under **Configuration → Appearance**
and look through the app; the choice is remembered by your browser.

To list what's left to translate, run:

```bash
npm --prefix frontend run i18n:check es
```

It prints how much of the language is done, each key that's still missing, and any key that English no longer
uses (which you can delete). Without a code, it checks every language.

## Tools and shared widgets

The [tools](guides/tools.md) in [`tools/`](../tools) and the shared dashboard widgets in
[`community-widgets/`](../community-widgets) carry their own words, one file per language in each one's `locales`
folder. To translate one, copy its `locales/en.json` to your language's code, translate the values, and add the code to
`locales` in its metadata: a widget's `widget.json`, or a tool's `tool.json` and the `source/tool.base.json` it's built
from, the same in both. Their placeholders take single braces, such as `{n}`, and there are no plural forms. One
without your language shows English.

## Keeping up

New features add English text first. Translations catch up whenever someone has time, and until then the new text
shows in English. If you'd like to look after a language, say so in your pull request, so we know who to ask.
