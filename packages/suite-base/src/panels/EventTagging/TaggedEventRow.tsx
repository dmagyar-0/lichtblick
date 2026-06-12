// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { alpha, IconButton, MenuItem, TextField, Typography } from "@mui/material";
import { makeStyles } from "tss-react/mui";

import Stack from "@lichtblick/suite-base/components/Stack";
import { TimelinePositionedEvent } from "@lichtblick/suite-base/context/EventsContext";

import { getVisibleAttributeDefinitions, normalizeOption } from "./eventUtils";
import { EventAttributeDefinition, TaggedEvent } from "./types";

const useStyles = makeStyles()((theme) => ({
  root: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(1),
    cursor: "pointer",
    backgroundColor: theme.palette.background.default,

    "&:hover": {
      backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
      borderColor: theme.palette.info.main,
    },
  },
  rootHovered: {
    backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
    borderColor: theme.palette.info.main,
  },
  rootSelected: {
    backgroundColor: alpha(theme.palette.info.main, theme.palette.action.activatedOpacity),
    borderColor: theme.palette.info.main,
    boxShadow: `0 0 0 1px ${theme.palette.info.main}`,
  },
  attributeField: {
    minWidth: 96,
  },
}));

function formatRange(event: TaggedEvent): string | undefined {
  const beforeSec = event.beforeSec ?? 0;
  const afterSec = event.afterSec ?? 0;
  if (beforeSec === 0 && afterSec === 0) {
    return undefined;
  }
  return `-${beforeSec}s / +${afterSec}s`;
}

function TaggedEventRowComponent(props: {
  event: TaggedEvent;
  positionedEvent: TimelinePositionedEvent;
  formattedTime: string;
  isHovered: boolean;
  isSelected: boolean;
  attributeDefinitions: readonly EventAttributeDefinition[];
  onClick: (event: TimelinePositionedEvent) => void;
  onHoverStart: (event: TimelinePositionedEvent) => void;
  onHoverEnd: () => void;
  onChangeAttribute: (eventId: string, key: string, value: string) => void;
  onDelete: (eventId: string) => void;
}): React.JSX.Element {
  const {
    event,
    positionedEvent,
    formattedTime,
    isHovered,
    isSelected,
    attributeDefinitions,
    onClick,
    onHoverStart,
    onHoverEnd,
    onChangeAttribute,
    onDelete,
  } = props;
  const { classes, cx } = useStyles();

  const range = formatRange(event);

  return (
    <div
      data-testid="tagged-event-row"
      className={cx(classes.root, {
        [classes.rootHovered]: isHovered,
        [classes.rootSelected]: isSelected,
      })}
      onClick={() => {
        onClick(positionedEvent);
      }}
      onMouseEnter={() => {
        onHoverStart(positionedEvent);
      }}
      onMouseLeave={onHoverEnd}
    >
      <Stack gap={1}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Stack direction="row" alignItems="baseline" gap={1} overflow="hidden">
            <Typography variant="body2" noWrap>
              {formattedTime}
            </Typography>
            {range && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {range}
              </Typography>
            )}
          </Stack>
          <IconButton
            size="small"
            edge="end"
            title="Delete event"
            onClick={(mouseEvent) => {
              mouseEvent.stopPropagation();
              onDelete(event.id);
            }}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack direction="row" gap={1} flexWrap="wrap">
          {getVisibleAttributeDefinitions(attributeDefinitions, event.attributes).map(
            (definition) => (
              <TextField
                key={definition.key}
                className={classes.attributeField}
                select
                size="small"
                variant="filled"
                label={definition.label ?? definition.key}
                value={event.attributes[definition.key] ?? ""}
                onClick={(mouseEvent) => {
                  mouseEvent.stopPropagation();
                }}
                onChange={(changeEvent) => {
                  onChangeAttribute(event.id, definition.key, changeEvent.target.value);
                }}
              >
                {definition.options.map(normalizeOption).map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label ?? option.value}
                  </MenuItem>
                ))}
              </TextField>
            ),
          )}
        </Stack>
      </Stack>
    </div>
  );
}

export const TaggedEventRow = React.memo(TaggedEventRowComponent);
