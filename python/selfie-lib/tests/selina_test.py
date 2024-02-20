import unittest
from selfie_lib import get_interesting_fact

class TestGetInterestingFact(unittest.TestCase):
    def test_science_fact(self):
        fact = get_interesting_fact("science")
        self.assertEqual(fact, "Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still perfectly edible.")

    def test_history_fact(self):
        fact = get_interesting_fact("history")
        self.assertEqual(fact, "The shortest war in history lasted only 38 minutes. It was between Britain and Zanzibar on August 27, 1896.")

    def test_animals_fact(self):
        fact = get_interesting_fact("animals")
        self.assertEqual(fact, "Penguins only have one mate their entire life. They also propose to their lifemates with a pebble.")

    def test_technology_fact(self):
        fact = get_interesting_fact("technology")
        self.assertEqual(fact, "The first computer virus was created in 1983 and was called the 'Elk Cloner'. It infected Apple II computers via floppy disks.")

    def test_invalid_category(self):
        fact = get_interesting_fact("invalid")
        self.assertEqual(fact, "Sorry, I don't have an interesting fact for that category.")
