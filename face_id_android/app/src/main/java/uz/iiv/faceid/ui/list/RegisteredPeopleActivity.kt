package uz.iiv.faceid.ui.list

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.addTextChangedListener
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uz.iiv.faceid.database.AppDatabase
import uz.iiv.faceid.database.FaceEntity
import uz.iiv.faceid.databinding.ActivityRegisteredPeopleBinding
import uz.iiv.faceid.ui.add.AddPersonActivity
import uz.iiv.faceid.ui.details.PersonDetailsActivity

class RegisteredPeopleActivity : AppCompatActivity() {

    private lateinit var binding: ActivityRegisteredPeopleBinding
    private lateinit var adapter: PersonAdapter
    private var allPeople: List<FaceEntity> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityRegisteredPeopleBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = PersonAdapter { person ->
            val intent = Intent(this, PersonDetailsActivity::class.java).apply {
                putExtra("PERSON_ID", person.id)
            }
            startActivity(intent)
        }

        binding.rvRegisteredPeople.layoutManager = LinearLayoutManager(this)
        binding.rvRegisteredPeople.adapter = adapter

        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.btnAddNew.setOnClickListener {
            startActivity(Intent(this, AddPersonActivity::class.java))
        }

        binding.etSearch.addTextChangedListener { text ->
            filterList(text?.toString().orEmpty())
        }
    }

    override fun onResume() {
        super.onResume()
        loadData()
    }

    private fun loadData() {
        lifecycleScope.launch(Dispatchers.IO) {
            val list = AppDatabase.getInstance(applicationContext).faceDao().getAll()
            allPeople = list
            withContext(Dispatchers.Main) {
                binding.tvCountBadge.text = "JAMI: ${list.size}"
                filterList(binding.etSearch.text?.toString().orEmpty())
            }
        }
    }

    private fun filterList(query: String) {
        val filtered = if (query.isBlank()) {
            allPeople
        } else {
            allPeople.filter { it.fullName.contains(query, ignoreCase = true) || it.role.contains(query, ignoreCase = true) }
        }
        adapter.submitList(filtered)
    }
}
