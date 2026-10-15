ALTER TABLE story_signals ADD CONSTRAINT story_signals_section_article_id_fk FOREIGN KEY (section_id, article_id) REFERENCES articles (section_id, id) ON DELETE CASCADE NOT VALID;
