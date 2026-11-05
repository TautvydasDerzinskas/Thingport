import React from "react";
import Link from "@mui/material/Link";

// A link someone pastes should open, in a new tab: Thingport's own included, as the chat stays where it was.
const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}])/g;

/** A message's text as written, its links clickable. */
export default function MessageText({ body }: { body: string }) {
  const parts = body.split(URL_PATTERN);
  return (
    <>
      {/* The parts are the text's own, in order: where each falls is what tells them apart. */}
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Link
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            color="inherit"
            sx={{ textDecorationColor: "currentColor", wordBreak: "break-all" }}
          >
            {part}
          </Link>
        ) : (
          // oxlint-disable-next-line react/no-array-index-key
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}
