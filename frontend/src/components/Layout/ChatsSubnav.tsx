import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { dividerBorderColor } from "../../theme";
import ChatList from "../chats/ChatList";

const WIDTH = 300;

/** Chats' list, in a second column beside the sidebar while Chats is open, as Administration's pages are. On phones the
 *  list is Chats' page itself. */
export default function ChatsSubnav({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const { t } = useTranslation("app");
  return (
    <Box
      component="nav"
      aria-label={t("sidebar.chats")}
      sx={{
        width: WIDTH,
        flexShrink: 0,
        height: "100vh",
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid",
        borderColor: dividerBorderColor,
        bgcolor: (theme) => theme.thingport.subnavBackground,
        overflow: "hidden",
      }}
    >
      {/* As tall as the folded sidebar's logo row beside it, so both columns' lists start level. */}
      <Stack direction="row" alignItems="center" sx={{ px: 2, pt: "20px", pb: "20px", minHeight: 72 }}>
        <Typography variant="subtitle2" fontWeight={700} noWrap>
          {t("sidebar.chats")}
        </Typography>
      </Stack>
      <ChatList onUnauthorized={onUnauthorized} />
    </Box>
  );
}
