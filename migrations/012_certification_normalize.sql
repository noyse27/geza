UPDATE media SET certification='FSK '||certification WHERE certification ~ '^[0-9]+$';
