import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { MigratePerson } from "../../api/migrate";
import HelpTip from "../../components/HelpTip";
import ToneChip from "../../components/ToneChip";
import { k } from "./parts";

type Props = {
  people: MigratePerson[];
  chosen: ReadonlySet<string>;
  onChange: (chosen: Set<string>) => void;
  disabled?: boolean;
};

/** The old instance's people: who comes, and who's merged into an account here by having the same email. */
export default function PeopleStep({ people, chosen, onChange, disabled }: Props) {
  const { t } = useTranslation("app");
  const all = people.length > 0 && people.every((person) => chosen.has(person.id));
  const some = people.some((person) => chosen.has(person.id));
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {t(k("people.intro"))}
        <HelpTip text={t(k("people.introHelp"))} />
      </Typography>
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" aria-label={t(k("steps.people"))}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={all}
                  indeterminate={some && !all}
                  disabled={disabled}
                  onChange={() => onChange(all ? new Set() : new Set(people.map((person) => person.id)))}
                  slotProps={{ input: { "aria-label": t(k("people.everyone")) } }}
                />
              </TableCell>
              <TableCell>{t(k("people.person"))}</TableCell>
              <TableCell align="right">{t(k("people.models"))}</TableCell>
              <TableCell>{t(k("people.here"))}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {people.map((person) => (
              <TableRow key={person.id} hover onClick={() => !disabled && toggle(person.id)} sx={{ cursor: "pointer" }}>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={chosen.has(person.id)}
                    disabled={disabled}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggle(person.id)}
                    slotProps={{ input: { "aria-label": person.name } }}
                  />
                </TableCell>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {person.name}
                    </Typography>
                    {(person.owner || person.role === "ADMIN") && (
                      <ToneChip tone="neutral" label={t(k(person.owner ? "people.owner" : "people.admin"))} />
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" noWrap component="p">
                    {person.email}
                  </Typography>
                </TableCell>
                <TableCell align="right">{person.models.toLocaleString()}</TableCell>
                <TableCell>
                  {person.merge ? (
                    <ToneChip tone="info" label={t(k("people.merge"), { name: person.merge.name })} />
                  ) : (
                    <ToneChip tone="neutral" label={t(k("people.new"))} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}
