ALTER TABLE guild ADD COLUMN guildTagMessage VARCHAR(2048) DEFAULT 'Hey <name>, welcome to <guildtag>''s army!';
ALTER TABLE guild ADD COLUMN guildTagMessageEnabled TINYINT DEFAULT 0;
