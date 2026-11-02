package uz.iiv.faceid.ui.list

import android.graphics.BitmapFactory
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import uz.iiv.faceid.database.FaceEntity
import uz.iiv.faceid.databinding.ItemPersonBinding
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PersonAdapter(
    private val onItemClick: (FaceEntity) -> Unit
) : RecyclerView.Adapter<PersonAdapter.PersonViewHolder>() {

    private val items = mutableListOf<FaceEntity>()
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())

    fun submitList(newItems: List<FaceEntity>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PersonViewHolder {
        val binding = ItemPersonBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return PersonViewHolder(binding)
    }

    override fun onBindViewHolder(holder: PersonViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    inner class PersonViewHolder(private val binding: ItemPersonBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(person: FaceEntity) {
            binding.tvPersonName.text = person.fullName
            binding.tvPersonRole.text = person.role
            binding.tvPersonDate.text = "Ro'yxatga olindi: ${dateFormat.format(Date(person.createdAt))}"

            if (!person.imagePath.isNullOrEmpty()) {
                val file = File(person.imagePath)
                if (file.exists()) {
                    val bitmap = BitmapFactory.decodeFile(file.absolutePath)
                    if (bitmap != null) {
                        binding.ivPersonPhoto.setImageBitmap(bitmap)
                    }
                }
            }

            binding.root.setOnClickListener {
                onItemClick(person)
            }
        }
    }
}
