# Import with a bookmarklet

A bookmarklet is a bookmark that runs a small piece of code instead of opening a page. Thingport's bookmarklet sends
the page you're on to your Thingport: click it on a model's page, and Thingport opens in a new tab with the import
dialog already filled in with that page's link. One more click on **Import** and the model is on its way.

> **[Thingport Grab](../../extension/README.md), the browser extension, is the recommended way to import.** It
> imports right on the model page, files the model into a collection, imports whole collections, and some sites, such
> as MakerOnline, only work through it. The bookmarklet is an alternative for when you can't or would rather not
> install the extension: it works in any browser, with nothing to install, one model at a time.

## Add the bookmarklet

1. Show your browser's bookmarks bar: **Ctrl+Shift+B**, or **⌘⇧B** on a Mac.
2. In Thingport, open **Add → Import** and click **Learn about bookmarklets**.
3. Drag the **Send to Thingport** button onto the bookmarks bar.

The bookmarklet points at the address you opened Thingport at when you dragged it. If you later move Thingport to
another address, drag a new one.

### Can't drag it?

On a phone, or a browser that won't drop links on its bookmarks bar, add it by hand:

1. Click the copy button next to **Send to Thingport** to copy the bookmarklet's code.
2. Bookmark any page.
3. Edit that bookmark: name it something like _Send to Thingport_, and paste the code in place of its address.

The copy button needs Thingport to be opened over HTTPS or on `localhost`. On a plain-HTTP address, right-click
**Send to Thingport** and copy the link instead.

## Use it

1. Open a model's page on any [supported site](../features/importing.md): MakerWorld, Printables, Thingiverse,
   MyMiniFactory, Snapmaker Space, MakerOnline, Creality Cloud, NexPrint, Thangs, Cults3D, eufyMake, Pinshape or 3DPrint.social.
2. Click **Send to Thingport** in the bookmarks bar.
3. Thingport opens with the link in the import dialog. Pick the print profiles to bring in if the site has them, then
   click **Import**.

If you're signed out, Thingport asks you to sign in first, and then opens the import dialog with the link.

Nothing is imported until you click **Import**, so clicking the bookmarklet on the wrong page only opens the
dialog, which you can cancel. Anything the import dialog can't take, such as a MakerWorld
collection, is still for Thingport Grab.

## If a new tab doesn't open

Some sites or browsers stop pages from opening new tabs. The bookmarklet then opens Thingport in the same tab instead;
press back to return to the model's page.
